from __future__ import annotations

import os
import sys

from sqlalchemy.orm import joinedload

SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import models  # noqa: E402
from app.database import Base, SessionLocal, engine, run_startup_migrations  # noqa: E402
from app.music_theory import derive_chart_key, estimate_key_from_sections, normalize_capo_value  # noqa: E402


def song_sections_to_raw(song: models.Song) -> list[dict]:
    return [
        {
            "label": section.label,
            "lines": [
                {
                    "lyrics": line.lyrics,
                    "chords": [
                        {"position": chord.position, "chord_name": chord.chord_name}
                        for chord in line.chords
                    ],
                }
                for line in section.lines
            ],
        }
        for section in song.sections
    ]


def main():
    Base.metadata.create_all(bind=engine)
    run_startup_migrations()

    db = SessionLocal()
    try:
        songs = (
            db.query(models.Song)
            .options(
                joinedload(models.Song.sections)
                .joinedload(models.Section.lines)
                .joinedload(models.Line.chords)
            )
            .order_by(models.Song.created_at.asc())
            .all()
        )

        print(f"Loaded {len(songs)} songs")

        updated_count = 0
        for song in songs:
            capo = normalize_capo_value(song.capo)
            estimated_original_key = estimate_key_from_sections(
                song_sections_to_raw(song),
                capo=capo,
                fallback=song.original_key or song.key,
            ) or song.original_key or song.key
            chart_key = derive_chart_key(estimated_original_key, capo) or song.key

            if song.key != chart_key or song.original_key != estimated_original_key:
                print(
                    f"[update] {song.title} / {song.artist}: "
                    f"original={song.original_key} -> {estimated_original_key}, "
                    f"chart={song.key} -> {chart_key} (capo={capo})"
                )
                song.original_key = estimated_original_key
                song.key = chart_key
                updated_count += 1
            else:
                print(
                    f"[keep] {song.title} / {song.artist}: "
                    f"original={song.original_key}, chart={song.key} (capo={capo})"
                )

        db.commit()
        print(f"Updated {updated_count} songs")
    finally:
        db.close()


if __name__ == "__main__":
    main()
