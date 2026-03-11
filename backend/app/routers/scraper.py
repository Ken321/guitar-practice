import sys
import os
from urllib.parse import urlparse
# Add backend directory to path so 'scraper' package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fastapi import APIRouter, HTTPException
from ..schemas import ScrapeRequest, ScrapeResponse, SectionCreate, LineCreate, ChordPlacementCreate
from scraper.ufrelet import UFretScraper
from scraper.gakki_me import GakkiMeScraper

router = APIRouter(prefix="/scrape", tags=["scraper"])


def _convert_sections(raw_sections: list) -> list[SectionCreate]:
    sections = []
    for i, sec in enumerate(raw_sections):
        lines = []
        for j, line_data in enumerate(sec.get("lines", [])):
            chords = []
            for c in line_data.get("chords", []):
                chords.append(ChordPlacementCreate(
                    position=c.get("position", 0),
                    chord_name=c.get("chord_name", ""),
                    preferred_voicing=0,
                ))
            lines.append(LineCreate(
                order=j,
                lyrics=line_data.get("lyrics", ""),
                chords=chords,
            ))
        sections.append(SectionCreate(
            order=i,
            label=sec.get("label", ""),
            lines=lines,
        ))
    return sections


def _build_scrape_response(result: dict) -> ScrapeResponse:
    return ScrapeResponse(
        sections=_convert_sections(result["sections"]),
        detected_key=result.get("detected_key"),
        detected_original_key=result.get("detected_original_key"),
        detected_capo=result.get("detected_capo", 0),
        source_url=result.get("source_url", ""),
        detected_title=result.get("detected_title"),
        detected_artist=result.get("detected_artist"),
    )


def _get_scraper_for_url(url: str):
    host = urlparse(url).netloc.lower()
    if "ufret.jp" in host:
        return UFretScraper()
    if "gakki.me" in host:
        return GakkiMeScraper()
    return None


@router.post("", response_model=ScrapeResponse)
async def scrape_song(request: ScrapeRequest):
    if request.url:
        scraper = _get_scraper_for_url(request.url)
        if not scraper:
            raise HTTPException(
                status_code=400,
                detail="対応しているURLは U-フレット と 楽器.me のみです",
            )

        try:
            result = await scraper.scrape_url(request.url)
            if result and result.get("sections"):
                return _build_scrape_response(result)
        except Exception as e:
            print(f"URL scraper failed: {e}")

        raise HTTPException(
            status_code=404,
            detail=f"Could not find chord data from URL: {request.url}"
        )

    if not request.title or not request.artist:
        raise HTTPException(
            status_code=422,
            detail="曲名とアーティスト名、またはURLを指定してください",
        )

    # Try U-フレット first
    try:
        scraper = UFretScraper()
        result = await scraper.scrape(request.title, request.artist)
        if result and result.get("sections"):
            return _build_scrape_response(result)
    except Exception as e:
        print(f"UFret scraper failed: {e}")

    # Fallback to 楽器.me
    try:
        scraper = GakkiMeScraper()
        result = await scraper.scrape(request.title, request.artist)
        if result and result.get("sections"):
            return _build_scrape_response(result)
    except Exception as e:
        print(f"GakkiMe scraper failed: {e}")

    raise HTTPException(
        status_code=404,
        detail=f"Could not find chord data for '{request.title}' by '{request.artist}'"
    )
