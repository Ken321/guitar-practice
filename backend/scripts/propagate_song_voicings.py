"""
Propagate custom voicing settings to all same-name chords within each song.

When a user saves a voicing for chord X in a song, only the clicked placement
gets updated. Other placements of the same chord name remain with
has_custom_voicing=False and no signature. This script backfills the missing data.

For each song, for each chord_name that has at least one custom voicing:
  - Pick the most-common voicing signature among custom placements
  - Apply it to all placements with the same chord_name that lack a custom voicing
"""

from __future__ import annotations

import os
import sys
from collections import Counter

SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        songs = db.query(models.Song).all()
        total_updated = 0

        for song in songs:
            # Collect all chord placements in this song
            placements: list[models.ChordPlacement] = []
            for section in song.sections:
                for line in section.lines:
                    placements.extend(line.chords)

            # Group by chord_name
            by_chord_name: dict[str, list[models.ChordPlacement]] = {}
            for p in placements:
                by_chord_name.setdefault(p.chord_name, []).append(p)

            for chord_name, group in by_chord_name.items():
                custom = [p for p in group if p.has_custom_voicing and p.preferred_voicing_signature]
                non_custom = [p for p in group if not p.has_custom_voicing]

                if not custom or not non_custom:
                    continue

                # Find dominant voicing (most common among custom placements)
                counter: Counter[tuple] = Counter(
                    (p.preferred_voicing, p.preferred_voicing_signature, p.preferred_voicing_chord_name)
                    for p in custom
                )
                dominant_voicing, dominant_sig, dominant_chord_name = counter.most_common(1)[0][0]

                print(
                    f"  Song '{song.title}' chord '{chord_name}': "
                    f"propagating sig={dominant_sig!r} to {len(non_custom)} placement(s)"
                )

                for p in non_custom:
                    p.has_custom_voicing = True
                    p.preferred_voicing = dominant_voicing
                    p.preferred_voicing_signature = dominant_sig
                    p.preferred_voicing_chord_name = dominant_chord_name
                    total_updated += 1

        if total_updated > 0:
            db.commit()
            print(f"\nDone. Updated {total_updated} placement(s).")
        else:
            print("No placements needed updating.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
