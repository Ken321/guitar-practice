from abc import ABC, abstractmethod
from typing import Optional
from app.music_theory import derive_chart_key, estimate_key_from_sections, normalize_capo_value, normalize_key_name


class ScraperBase(ABC):
    """
    Abstract base class for chord scrapers.

    The `scrape` method should return a dict with the following structure:
    {
        "sections": [
            {
                "label": str,  # e.g. "イントロ", "Aメロ", "サビ"
                "lines": [
                    {
                        "lyrics": str,
                        "chords": [
                            {
                                "position": int,  # 0-indexed character position in lyrics
                                "chord_name": str,  # e.g. "Am7"
                            }
                        ]
                    }
                ]
            }
        ],
        "detected_key": str | None,  # e.g. displayed/chart key "C", "Am"
        "detected_original_key": str | None,  # e.g. concert key "Eb", "Cm"
        "detected_capo": int,        # e.g. 0, 2
        "source_url": str,
    }
    """

    @abstractmethod
    async def scrape(self, title: str, artist: str) -> dict:
        """
        Scrape chord data for a song.

        Args:
            title: Song title
            artist: Artist name

        Returns:
            Dict with keys: sections, detected_key, source_url
        """
        pass

    @abstractmethod
    async def scrape_url(self, url: str) -> dict:
        """
        Scrape chord data from a song page URL directly.

        Args:
            url: Song page URL

        Returns:
            Dict with keys: sections, detected_key, source_url, detected_title, detected_artist
        """
        pass

    def _build_result(
        self,
        sections: list,
        source_url: str,
        detected_key: Optional[str] = None,
        detected_capo: Optional[int] = 0,
        detected_title: Optional[str] = None,
        detected_artist: Optional[str] = None,
    ) -> dict:
        capo = normalize_capo_value(detected_capo)
        normalized_key = normalize_key_name(detected_key)
        estimated_original_key = estimate_key_from_sections(sections, capo=capo, fallback=normalized_key)
        detected_chart_key = derive_chart_key(estimated_original_key, capo) or estimate_key_from_sections(sections, capo=0)

        return {
            "sections": sections,
            "detected_key": detected_chart_key,
            "detected_original_key": estimated_original_key,
            "detected_capo": capo,
            "source_url": source_url,
            "detected_title": detected_title,
            "detected_artist": detected_artist,
        }
