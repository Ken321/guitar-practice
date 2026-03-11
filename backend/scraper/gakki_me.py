import asyncio
import re
from urllib.parse import quote
from typing import Optional
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from .base import ScraperBase
from app.music_theory import parse_capo_text


GAKKI_BASE = "https://gakki.me"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


class GakkiMeScraper(ScraperBase):
    """Scraper for 楽器.me (gakki.me) - fallback scraper."""

    async def scrape(self, title: str, artist: str) -> dict:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=USER_AGENT)
            page = await context.new_page()

            try:
                # Search for the song
                search_query = f"{title} {artist}"
                search_url = f"{GAKKI_BASE}/search?q={quote(search_query)}"
                await page.goto(search_url, wait_until="networkidle", timeout=30000)
                await asyncio.sleep(3)

                # Find first result link
                song_url = await self._find_first_result(page)
                if not song_url:
                    return self._build_result([], source_url=search_url, detected_key=None)

                return await self._scrape_song_page(page, song_url)

            except PlaywrightTimeoutError:
                return self._build_result([], source_url=GAKKI_BASE, detected_key=None)
            except Exception as e:
                print(f"GakkiMeScraper error: {e}")
                return self._build_result([], source_url=GAKKI_BASE, detected_key=None)
            finally:
                await context.close()
                await browser.close()

    async def scrape_url(self, url: str) -> dict:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=USER_AGENT)
            page = await context.new_page()

            try:
                return await self._scrape_song_page(page, url)
            except PlaywrightTimeoutError:
                return self._build_result([], source_url=url, detected_key=None)
            except Exception as e:
                print(f"GakkiMeScraper URL error: {e}")
                return self._build_result([], source_url=url, detected_key=None)
            finally:
                await context.close()
                await browser.close()

    async def _scrape_song_page(self, page, song_url: str) -> dict:
        await asyncio.sleep(1)
        await page.goto(song_url, wait_until="networkidle", timeout=30000)
        await asyncio.sleep(2)

        sections = await self._extract_chords(page)
        detected_key = await self._detect_key(page)
        detected_capo = await self._detect_capo(page)
        detected_title, detected_artist = await self._extract_song_metadata(page)

        return self._build_result(
            sections,
            source_url=song_url,
            detected_key=detected_key,
            detected_capo=detected_capo,
            detected_title=detected_title,
            detected_artist=detected_artist,
        )

    async def _find_first_result(self, page) -> Optional[str]:
        """Find the first search result."""
        try:
            # Try common search result selectors
            selectors = [
                "a[href*='/song/']",
                "a[href*='/chord/']",
                ".search-result a",
                ".result-item a",
                "h2 a[href]",
                "h3 a[href]",
                ".song-title a",
            ]

            for selector in selectors:
                links = await page.query_selector_all(selector)
                for link in links[:5]:
                    href = await link.get_attribute("href")
                    if href:
                        if not href.startswith("http"):
                            href = GAKKI_BASE + href
                        return href

        except Exception as e:
            print(f"Error finding result in GakkiMe: {e}")

        return None

    async def _extract_chords(self, page) -> list:
        """Extract chord and lyrics structure from the song page."""
        sections = []

        try:
            raw_data = await page.evaluate(r"""
                () => {
                    const result = { sections: [] };
                    let currentSection = { label: 'Verse', lines: [] };

                    // Try to find the chord content area
                    const selectors = ['#chord-area', '.chord-area', '.chord-sheet', '.song-content', 'main', 'article'];
                    let area = null;
                    for (const sel of selectors) {
                        area = document.querySelector(sel);
                        if (area) break;
                    }
                    if (!area) area = document.body;

                    const sectionPattern = /^[\\[【](.*?)[\\]】]$/;
                    const chordPattern = /^(\\s*[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]?(\\s+[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]?)*\\s*)$/;

                    const rows = area.querySelectorAll('p, div, .row, .line, li');
                    let prevChordLine = null;

                    for (const row of rows) {
                        const text = row.innerText.trim();
                        if (!text) continue;

                        // Section label detection
                        const sectionMatch = text.match(sectionPattern);
                        if (sectionMatch) {
                            if (currentSection.lines.length > 0) {
                                result.sections.push({...currentSection});
                            }
                            currentSection = { label: sectionMatch[1], lines: [] };
                            prevChordLine = null;
                            continue;
                        }

                        // Section keyword detection
                        if (text.match(/^(イントロ|Aメロ|Bメロ|サビ|アウトロ|間奏|ブリッジ|Intro|Verse|Chorus|Bridge|Outro)$/i)) {
                            if (currentSection.lines.length > 0) {
                                result.sections.push({...currentSection});
                            }
                            currentSection = { label: text, lines: [] };
                            prevChordLine = null;
                            continue;
                        }

                        // Chord line detection
                        const words = text.split(/\\s+/).filter(w => w.length > 0);
                        const isChordLine = words.length > 0 && words.every(w =>
                            w.match(/^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M|7|9|11|13)*(\/[A-G][#b]?)?$/)
                        );

                        if (isChordLine) {
                            prevChordLine = text;
                        } else {
                            // Lyric line
                            const chords = [];
                            if (prevChordLine) {
                                const chordMatches = [...prevChordLine.matchAll(/([A-G][#b]?(m|maj|min|dim|aug|sus|add|M|7|9|11|13)*(\/[A-G][#b]?)?)/g)];
                                for (const match of chordMatches) {
                                    const ratio = match.index / Math.max(prevChordLine.length, 1);
                                    const position = Math.floor(ratio * Math.max(text.length, 1));
                                    chords.push({ position, chord_name: match[0] });
                                }
                            }
                            currentSection.lines.push({ lyrics: text, chords });
                            prevChordLine = null;
                        }
                    }

                    if (currentSection.lines.length > 0) {
                        result.sections.push(currentSection);
                    }

                    return result;
                }
            """)

            if raw_data.get("sections"):
                sections = [s for s in raw_data["sections"] if s.get("lines")]

        except Exception as e:
            print(f"Error extracting chords from GakkiMe: {e}")

        return sections if sections else [{"label": "Verse", "lines": [{"lyrics": "", "chords": []}]}]

    async def _detect_key(self, page) -> Optional[str]:
        """Detect the key of the song from the page."""
        try:
            key_text = await page.evaluate(r"""
                () => {
                    const keySelectors = ['.key', '#key', '[class*="key"]'];
                    for (const sel of keySelectors) {
                        const el = document.querySelector(sel);
                        if (el && /([A-G][#b]?m?)/.test(el.innerText)) return el.innerText.trim();
                    }

                    const bodyText = document.body.innerText;
                    const keyMatch = bodyText.match(/[Kk]ey[：:]\s*([A-G][#b]?m?)/);
                    if (keyMatch) return keyMatch[1];
                    const jpKeyMatch = bodyText.match(/キー[：:]\s*([A-G][#b]?m?)/);
                    if (jpKeyMatch) return jpKeyMatch[1];

                    return null;
                }
            """)
            return key_text if key_text else None
        except Exception:
            return None

    async def _detect_capo(self, page) -> int:
        try:
            capo_text = await page.evaluate(r"""
                () => {
                    const selectors = ['.capo', '[class*="capo"]', '[id*="capo"]'];
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el && el.innerText.trim()) return el.innerText.trim();
                    }

                    const bodyText = document.body.innerText;
                    const match = bodyText.match(/(?:capo|カポ)\s*[：:=]?\s*\d{1,2}|(?:capo|カポ)\s*なし/iu);
                    return match ? match[0] : null;
                }
            """)
            return parse_capo_text(capo_text) or 0
        except Exception:
            return 0

    async def _extract_song_metadata(self, page) -> tuple[Optional[str], Optional[str]]:
        try:
            metadata = await page.evaluate(r"""
                () => {
                    const clean = (value) => value ? value.replace(/\\s+/g, ' ').trim() : '';
                    const getMeta = (name) => {
                        const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                        return clean(el?.content || '');
                    };

                    const artistCandidates = Array.from(
                        document.querySelectorAll('a[href*="/artist/"], a[href*="/search"], [class*="artist"], [id*="artist"]')
                    )
                        .map((el) => clean(el.textContent || ''))
                        .filter(Boolean)
                        .slice(0, 10);

                    return {
                        titleTag: clean(document.title),
                        heading: clean(document.querySelector('h1')?.textContent || ''),
                        metaTitle: getMeta('og:title'),
                        metaDescription: getMeta('og:description'),
                        artistCandidates,
                    };
                }
            """)

            title_sources = [
                metadata.get("heading", ""),
                metadata.get("metaTitle", ""),
                metadata.get("titleTag", ""),
            ]

            for source in title_sources:
                title, artist = self._parse_title_artist_text(source)
                if title or artist:
                    return title, artist

            meta_description = metadata.get("metaDescription", "")
            if meta_description:
                title, artist = self._parse_title_artist_text(meta_description)
                if title or artist:
                    return title, artist

            heading = metadata.get("heading", "") or metadata.get("metaTitle", "") or metadata.get("titleTag", "")
            title = self._cleanup_title_text(heading) or None
            artist_candidates = metadata.get("artistCandidates", [])
            artist = artist_candidates[0] if artist_candidates else None
            return title, artist
        except Exception:
            return None, None

    def _parse_title_artist_text(self, text: str) -> tuple[Optional[str], Optional[str]]:
        if not text:
            return None, None

        normalized = re.sub(r"\s+", " ", text).strip()
        patterns = [
            r"^(.+?)\s*/\s*(.+?)\s+(?:ギターコード譜|ギターコード|コード譜|楽器\.me).*$",
            r"^(.+?)\s*[／/]\s*(.+?)$",
            r"^(.+?)\s*-\s*(.+?)\s*$",
        ]

        for pattern in patterns:
            match = re.match(pattern, normalized)
            if match:
                return self._cleanup_title_text(match.group(1)), self._cleanup_artist_text(match.group(2))

        return self._cleanup_title_text(normalized), None

    def _cleanup_title_text(self, value: str) -> str:
        cleaned = re.sub(r"\s+(?:ギターコード譜|ギターコード|コード譜|楽器\.me).*$", "", value).strip()
        cleaned = cleaned.strip("「」[]【】")
        return cleaned

    def _cleanup_artist_text(self, value: str) -> str:
        cleaned = re.sub(r"\s+(?:ギターコード譜|ギターコード|コード譜|楽器\.me).*$", "", value).strip()
        cleaned = cleaned.strip("「」[]【】")
        return cleaned
