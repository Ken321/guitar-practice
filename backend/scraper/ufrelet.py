import asyncio
import re
from urllib.parse import quote
from typing import Optional
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from .base import ScraperBase
from app.music_theory import parse_capo_text


UFRET_BASE = "https://www.ufret.jp"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


class UFretScraper(ScraperBase):
    """Scraper for U-フレット (ufret.jp)."""

    async def scrape(self, title: str, artist: str) -> dict:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=USER_AGENT)
            page = await context.new_page()

            try:
                # Search for the song (title only; adding artist name often returns 0 results)
                search_url = f"{UFRET_BASE}/search.php?key={quote(title)}"
                print(f"[UFret] Searching: {search_url}")
                await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(2)

                # Find first result link
                song_url = await self._find_first_result(page, title, artist)
                print(f"[UFret] Found URL: {song_url}")
                if not song_url:
                    print("[UFret] No result found in search page")
                    return self._build_result([], source_url=search_url, detected_key=None)

                return await self._scrape_song_page(page, song_url)

            except PlaywrightTimeoutError as e:
                print(f"[UFret] Timeout: {e}")
                return self._build_result([], source_url=UFRET_BASE, detected_key=None)
            except Exception as e:
                print(f"[UFret] Error: {e}")
                return self._build_result([], source_url=UFRET_BASE, detected_key=None)
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
            except PlaywrightTimeoutError as e:
                print(f"[UFret] URL timeout: {e}")
                return self._build_result([], source_url=url, detected_key=None)
            except Exception as e:
                print(f"[UFret] URL error: {e}")
                return self._build_result([], source_url=url, detected_key=None)
            finally:
                await context.close()
                await browser.close()

    async def _scrape_song_page(self, page, song_url: str) -> dict:
        await asyncio.sleep(1)
        print(f"[UFret] Loading song page: {song_url}")
        await page.goto(song_url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)

        sections = await self._extract_chords(page)
        print(f"[UFret] Extracted {len(sections)} sections")
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

    async def _find_first_result(self, page, title: str, artist: str) -> Optional[str]:
        """Find the best matching search result linking to song.php."""
        try:
            links = await page.query_selector_all("a[href*='song.php?data']")
            print(f"[UFret] Found {len(links)} song.php links")

            artist_lower = artist.lower()
            seen = set()
            candidates = []

            for link in links[:20]:
                href = await link.get_attribute("href")
                text = await link.inner_text()
                if not href or href in seen:
                    continue
                seen.add(href)
                if not href.startswith("http"):
                    href = UFRET_BASE + "/" + href.lstrip("/")
                print(f"[UFret] Candidate: {href} | {text.strip()!r}")
                candidates.append((href, text.strip().lower()))

            # Prefer a result where the artist name appears in the link text
            for href, text in candidates:
                if artist_lower in text:
                    print(f"[UFret] Matched by artist: {href}")
                    return href

            # Fallback: return first unique candidate
            if candidates:
                print(f"[UFret] Using first candidate: {candidates[0][0]}")
                return candidates[0][0]

        except Exception as e:
            print(f"Error finding result: {e}")

        return None

    async def _extract_chords(self, page) -> list:
        """Extract chord and lyrics structure from ufret.jp song page.

        ufret.jp structure:
          div.chord-row           <- one music line
            p.chord               <- one chord + lyric segment
              span.krijcheug      <- chord diagram area
                ruby > rt         <- chord name in <rt>
              span.mejiowvnz      <- lyric area
                span.col          <- each lyric character
        """
        try:
            raw_data = await page.evaluate(r"""
                () => {
                    const result = { sections: [] };
                    let currentSection = { label: 'イントロ', lines: [] };
                    let sectionCount = 0;

                    // Walk all top-level children of the page body to find chord-rows and section labels
                    // Section labels appear as elements with text like [イントロ], [Aメロ] etc.
                    const allNodes = document.querySelectorAll('.chord-row, [class*="sectionLabel"], [class*="section-label"], h3, h4');

                    // If no chord-rows found, bail early
                    const chordRows = document.querySelectorAll('.chord-row');
                    if (chordRows.length === 0) {
                        return { sections: [], rawText: document.body.innerText.slice(0, 5000) };
                    }

                    // Look for section labels by walking parent elements of chord rows
                    // ufret.jp typically has section labels as preceding siblings or separate divs
                    const container = chordRows[0].parentElement || document.body;
                    const children = container.children;

                    for (const child of children) {
                        const cls = child.className || '';
                        const text = child.innerText ? child.innerText.trim() : '';

                        // Detect section label elements
                        if (!cls.includes('chord-row') && text) {
                            const sectionMatch = text.match(/^[\\[【]?\\s*(イントロ|Aメロ|Bメロ|サビ|アウトロ|間奏|ブリッジ|コーラス|ソロ|エンディング|verse|chorus|intro|bridge|outro)[\\s!！]*[\\]】]?$/i);
                            if (sectionMatch) {
                                if (currentSection.lines.length > 0) {
                                    result.sections.push(currentSection);
                                }
                                currentSection = { label: sectionMatch[1], lines: [] };
                                sectionCount++;
                                continue;
                            }
                        }

                        // Process chord-row
                        if (cls.includes('chord-row')) {
                            let lyrics = '';
                            const chords = [];
                            let charPos = 0;

                            // Each p.chord = one chord + its associated lyric segment
                            const chordSegments = child.querySelectorAll('p.chord');
                            for (const seg of chordSegments) {
                                // Chord name from <rt>
                                const rt = seg.querySelector('rt');
                                const chordName = rt ? rt.innerText.trim() : '';

                                // Lyric characters from span.col
                                const cols = seg.querySelectorAll('span.col');
                                let segLyric = '';
                                for (const col of cols) {
                                    segLyric += col.innerText;
                                }

                                if (chordName && chordName.match(/^[A-G]/)) {
                                    chords.push({ position: charPos, chord_name: chordName });
                                }
                                lyrics += segLyric;
                                charPos += segLyric.length;
                            }

                            if (lyrics.trim() || chords.length > 0) {
                                currentSection.lines.push({ lyrics: lyrics.trim(), chords });
                            }
                        }
                    }

                    if (currentSection.lines.length > 0) {
                        result.sections.push(currentSection);
                    }

                    return result;
                }
            """)

            sections = []
            if raw_data.get("sections"):
                for sec in raw_data["sections"]:
                    if sec.get("lines"):
                        sections.append(sec)

            if not sections and raw_data.get("rawText"):
                sections = self._parse_text_format(raw_data["rawText"])

            return sections if sections else self._create_empty_section()

        except Exception as e:
            print(f"Error extracting chords: {e}")
            return self._create_empty_section()

    def _parse_text_format(self, text: str) -> list:
        """Parse chord sheet from plain text format."""
        sections = []
        current_section = {"label": "Verse", "lines": []}
        lines = text.split("\n")

        chord_pattern = re.compile(
            r'^(\s*[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]?(\s+[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]?)*\s*)$'
        )
        section_pattern = re.compile(r'[\[【](.*?)[\]】]')

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            section_match = section_pattern.search(stripped)
            if section_match:
                if current_section["lines"]:
                    sections.append(current_section)
                current_section = {"label": section_match.group(1), "lines": []}
                i += 1
                continue

            if chord_pattern.match(stripped) and i + 1 < len(lines):
                chord_line = stripped
                lyric_line = lines[i + 1].strip() if i + 1 < len(lines) else ""

                chords = []
                chord_matches = list(re.finditer(
                    r'([A-G][#b]?(m|maj|min|dim|aug|sus|add|M|7|9|11|13)*(\/[A-G][#b]?)?)',
                    chord_line
                ))
                for match in chord_matches:
                    ratio = match.start() / max(len(chord_line), 1)
                    position = int(ratio * max(len(lyric_line), 1))
                    chords.append({"position": position, "chord_name": match.group(0)})

                if lyric_line or chords:
                    current_section["lines"].append({"lyrics": lyric_line, "chords": chords})
                i += 2
            elif stripped:
                current_section["lines"].append({"lyrics": stripped, "chords": []})
                i += 1
            else:
                i += 1

        if current_section["lines"]:
            sections.append(current_section)

        return sections

    def _create_empty_section(self) -> list:
        return [{"label": "Verse", "lines": [{"lyrics": "", "chords": []}]}]

    async def _detect_key(self, page) -> Optional[str]:
        """Detect the key of the song from the page."""
        try:
            key_text = await page.evaluate(r"""
                () => {
                    // ufret.jp shows key info in specific elements
                    const keySelectors = ['.key', '#key', '[class*="key"]', '.original-key'];
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
                        document.querySelectorAll('a[href*="artist"], a[href*="search"], [class*="artist"], [id*="artist"]')
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
            r"^(.+?)\s*/\s*(.+?)\s+(?:ギターコード|ウクレレコード|コード譜|楽譜|U-フレット).*$",
            r"^(.+?)\s*[／/]\s*(.+?)$",
            r"^(.+?)\s*-\s*(.+?)\s*$",
        ]

        for pattern in patterns:
            match = re.match(pattern, normalized)
            if match:
                return self._cleanup_title_text(match.group(1)), self._cleanup_artist_text(match.group(2))

        return self._cleanup_title_text(normalized), None

    def _cleanup_title_text(self, value: str) -> str:
        cleaned = re.sub(r"\s+(?:ギターコード|ウクレレコード|コード譜|楽譜|U-フレット).*$", "", value).strip()
        cleaned = cleaned.strip("「」[]【】")
        return cleaned

    def _cleanup_artist_text(self, value: str) -> str:
        cleaned = re.sub(r"\s+(?:ギターコード|ウクレレコード|コード譜|楽譜|U-フレット).*$", "", value).strip()
        cleaned = cleaned.strip("「」[]【】")
        return cleaned
