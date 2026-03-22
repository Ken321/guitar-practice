"""
Fix corrupted preferred_voicing_chord_name values in chord_placements.

Background:
  When a user saved a voicing while viewing the song in a non-original display key,
  the chord name was stored transposed (e.g., "Gm7/C" instead of the actual chord
  name "Dm7/G"). This caused findPreferredVoicingIndex to return null due to a
  name mismatch, falling back to the stale preferred_voicing integer index and
  showing the wrong voicing.

Fix:
  For chord_placements where preferred_voicing_chord_name differs from chord_name,
  reset the voicing data to defaults. The correct voicing will be re-derived from
  song-level preferences or the global ranking.

  Also cleans up VoicingPreference entries for chord names that don't match any
  actual chord in the DB (e.g., transposed names that were inadvertently written).
"""

from __future__ import annotations

import os
import sys

SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        # 1. Find chord_placements with mismatched preferred_voicing_chord_name
        bad_chords = (
            db.query(models.ChordPlacement)
            .filter(
                models.ChordPlacement.has_custom_voicing == True,  # noqa: E712
                models.ChordPlacement.preferred_voicing_chord_name != None,  # noqa: E711
                models.ChordPlacement.preferred_voicing_chord_name != models.ChordPlacement.chord_name,
            )
            .all()
        )

        if not bad_chords:
            print("No corrupted voicing chord names found.")
        else:
            print(f"Found {len(bad_chords)} corrupted chord_placement(s):")
            for chord in bad_chords:
                print(
                    f"  id={chord.id}  chord_name={chord.chord_name!r}"
                    f"  stored_chord_name={chord.preferred_voicing_chord_name!r}"
                    f"  signature={chord.preferred_voicing_signature!r}"
                )

            print("\nDecrementing VoicingPreference counts for corrupted entries...")
            for chord in bad_chords:
                if chord.preferred_voicing_chord_name and chord.preferred_voicing_signature:
                    pref = (
                        db.query(models.VoicingPreference)
                        .filter(
                            models.VoicingPreference.chord_name == chord.preferred_voicing_chord_name,
                            models.VoicingPreference.voicing_signature == chord.preferred_voicing_signature,
                        )
                        .first()
                    )
                    if pref:
                        pref.usage_count -= 1
                        if pref.usage_count <= 0:
                            db.delete(pref)
                            print(f"  Deleted VoicingPreference: chord_name={chord.preferred_voicing_chord_name!r}")
                        else:
                            print(f"  Decremented VoicingPreference: chord_name={chord.preferred_voicing_chord_name!r} -> {pref.usage_count}")

            print("\nResetting corrupted chord_placements to default voicing...")
            for chord in bad_chords:
                chord.has_custom_voicing = False
                chord.preferred_voicing = 0
                chord.preferred_voicing_signature = None
                chord.preferred_voicing_chord_name = None

            db.commit()
            print(f"Done. Reset {len(bad_chords)} chord_placement(s).")

        # 2. Report on VoicingPreference entries (for manual review)
        all_prefs = db.query(models.VoicingPreference).order_by(
            models.VoicingPreference.chord_name,
            models.VoicingPreference.usage_count.desc(),
        ).all()
        if all_prefs:
            print("\nCurrent VoicingPreference table:")
            for p in all_prefs:
                print(f"  chord={p.chord_name!r}  sig={p.voicing_signature!r}  count={p.usage_count}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
