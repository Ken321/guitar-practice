from __future__ import annotations

import asyncio
import os
import sys
from urllib.parse import urlparse

from sqlalchemy.orm import joinedload

SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import models  # noqa: E402
from app.database import Base, SessionLocal, engine, run_startup_migrations  # noqa: E402
from app.music_theory import derive_chart_key, estimate_key_from_sections, normalize_capo_value  # noqa: E402
from scraper.gakki_me import GakkiMeScraper  # noqa: E402
from scraper.ufrelet import UFretScraper  # noqa: E402


def get_scraper_for_url(url: str):
    host = urlparse(url).netloc.lower()
    if "ufret.jp" in host:
        return UFretScraper()
    if "gakki.me" in host:
        return GakkiMeScraper()
    return None


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


async def scrape_song_metadata(song: models.Song) -> dict | None:
    if not song.source_url:
        return None

    scraper = get_scraper_for_url(song.source_url)
    if not scraper:
        return None

    try:
        return await scraper.scrape_url(song.source_url)
    except Exception as exc:
        print(f"[skip] {song.title}: scrape failed: {exc}")
        return None


async def main():
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
            scraped = await scrape_song_metadata(song)
            raw_sections = (
                scraped.get("sections")
                if scraped and scraped.get("sections")
                else song_sections_to_raw(song)
            )

            capo = normalize_capo_value(
                scraped.get("detected_capo") if scraped else song.capo
            )
            estimated_original_key = estimate_key_from_sections(
                raw_sections,
                capo=capo,
                fallback=scraped.get("detected_original_key") if scraped else song.original_key or song.key,
            ) or song.original_key or song.key
            chart_key = derive_chart_key(estimated_original_key, capo) or song.key

            changed = False
            if song.capo != capo:
                song.capo = capo
                changed = True
            if song.original_key != estimated_original_key:
                song.original_key = estimated_original_key
                changed = True
            if song.key != chart_key:
                song.key = chart_key
                changed = True

            if changed:
                updated_count += 1
                print(
                    f"[update] {song.title} / {song.artist}: "
                    f"original={song.original_key}, chart={song.key}, capo={song.capo}"
                )
            else:
                print(
                    f"[keep] {song.title} / {song.artist}: "
                    f"original={song.original_key}, chart={song.key}, capo={song.capo}"
                )

        db.commit()
        print(f"Updated {updated_count} songs")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
