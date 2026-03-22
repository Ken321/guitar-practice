import asyncio
import re
from typing import Optional
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from .base import ScraperBase
from app.music_theory import parse_capo_text


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Matches a single chord word: Am, G7, Fmaj7, B7, F#m, Dsus4, C/E, etc.
CHORD_WORD_RE = re.compile(
    r'^[A-G][#b]?(?:maj|min|aug|dim|sus[24]?|add|M|m)?(?:[0-9]+)?(?:/[A-G][#b]?)?$'
)

# Section marker: [Intro], [Verse 1], [Chorus], [Bridge], etc.
SECTION_RE = re.compile(r'^\[(.+?)\]$')


def _is_chord_word(w: str) -> bool:
    return bool(CHORD_WORD_RE.match(w))


def _is_chord_line(line: str) -> bool:
    words = line.strip().split()
    return len(words) > 0 and all(_is_chord_word(w) for w in words)


class UltimateGuitarScraper(ScraperBase):
    """Scraper for Ultimate Guitar (tabs.ultimate-guitar.com)."""

    async def scrape(self, title: str, artist: str) -> dict:
        raise NotImplementedError("UltimateGuitarScraper only supports URL-based scraping")

    async def scrape_url(self, url: str) -> dict:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox"],
            )
            context = await browser.new_context(user_agent=USER_AGENT)
            page = await context.new_page()

            try:
                return await self._scrape_song_page(page, url)
            except PlaywrightTimeoutError as e:
                print(f"[UltimateGuitar] Timeout: {e}")
                return self._build_result([], source_url=url, detected_key=None)
            except Exception as e:
                print(f"[UltimateGuitar] Error: {e}")
                return self._build_result([], source_url=url, detected_key=None)
            finally:
                await context.close()
                await browser.close()

    async def _scrape_song_page(self, page, url: str) -> dict:
        print(f"[UltimateGuitar] Loading: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)

        data = await page.evaluate("""
            () => {
                const pre = document.querySelector('pre') || document.querySelector('code');
                const content = pre ? pre.textContent : null;

                const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
                const docTitle = document.title || '';

                // Key and capo from page text
                const bodyText = document.body.innerText;
                const capoM = bodyText.match(/Capo[:\\s]+([^\\n]+)/i);
                const keyM = bodyText.match(/(?:Key|Tonality)[:\\s]+([A-G][#b]?m?)/i);

                return {
                    content,
                    ogTitle,
                    docTitle,
                    capoText: capoM ? capoM[1].trim() : null,
                    keyText: keyM ? keyM[1].trim() : null,
                };
            }
        """)

        content = data.get("content")
        if not content:
            print("[UltimateGuitar] No <pre> content found")
            return self._build_result([], source_url=url, detected_key=None)

        print(f"[UltimateGuitar] Content length: {len(content)}")

        # Parse title / artist
        song_name, artist_name = self._parse_title_artist(
            data.get("ogTitle", ""), data.get("docTitle", "")
        )
        capo = parse_capo_text(data.get("capoText")) or 0
        key = data.get("keyText")

        print(f"[UltimateGuitar] Song: {song_name!r} / {artist_name!r}, Key: {key!r}, Capo: {capo}")

        sections = self._parse_content(content)
        print(f"[UltimateGuitar] Extracted {len(sections)} sections")

        return self._build_result(
            sections,
            source_url=url,
            detected_key=key,
            detected_capo=capo,
            detected_title=song_name,
            detected_artist=artist_name,
        )

    def _parse_title_artist(self, og_title: str, doc_title: str) -> tuple[Optional[str], Optional[str]]:
        """Extract title and artist from page title strings."""
        # og:title format: "Beck - Lazy Flies (Chords)"
        m = re.match(r'^(.+?)\s*-\s*(.+?)(?:\s*\(.*?\))?\s*$', og_title)
        if m:
            return m.group(2).strip(), m.group(1).strip()

        # doc title: "LAZY FLIES CHORDS by Beck @ Ultimate-Guitar.Com"
        m = re.match(r'^(.+?)\s+(?:CHORDS?|TABS?|CHORDS?\s+TABS?)\s+by\s+(.+?)\s*@', doc_title, re.IGNORECASE)
        if m:
            return m.group(1).strip().title(), m.group(2).strip().title()

        return og_title or None, None

    def _parse_content(self, content: str) -> list:
        """Parse plain-text chord chart from <pre> into sections with chords and lyrics."""
        sections = []
        current_section: dict = {"label": "Verse", "lines": []}
        pending_chord_line: Optional[str] = None  # raw chord line text

        for raw_line in content.splitlines():
            line = raw_line.rstrip()

            # Blank line: flush any pending chord line as empty lyric
            if not line.strip():
                if pending_chord_line is not None:
                    chords = self._extract_chord_positions(pending_chord_line)
                    current_section["lines"].append({"lyrics": "", "chords": chords})
                    pending_chord_line = None
                continue

            # Section marker: [Intro], [Verse 1], [Chorus], etc.
            m = SECTION_RE.match(line.strip())
            if m:
                if pending_chord_line is not None:
                    chords = self._extract_chord_positions(pending_chord_line)
                    current_section["lines"].append({"lyrics": "", "chords": chords})
                    pending_chord_line = None
                if current_section["lines"]:
                    sections.append(current_section)
                current_section = {"label": m.group(1), "lines": []}
                continue

            if _is_chord_line(line):
                # Pure chord line — remember it to pair with next lyric line
                if pending_chord_line is not None:
                    # Two chord lines in a row — flush first as empty lyric
                    chords = self._extract_chord_positions(pending_chord_line)
                    current_section["lines"].append({"lyrics": "", "chords": chords})
                pending_chord_line = line
                continue

            # Lyric line (or mixed line)
            lyrics = line  # preserve leading spaces for position alignment
            if pending_chord_line is not None:
                chords = self._map_chords_to_lyrics(pending_chord_line, lyrics)
                pending_chord_line = None
            else:
                chords = []
            current_section["lines"].append({"lyrics": lyrics.strip(), "chords": chords})

        # Flush any remaining pending chord line
        if pending_chord_line is not None:
            chords = self._extract_chord_positions(pending_chord_line)
            current_section["lines"].append({"lyrics": "", "chords": chords})

        if current_section["lines"]:
            sections.append(current_section)

        return [s for s in sections if s["lines"]]

    def _extract_chord_positions(self, chord_line: str) -> list:
        """Extract chords with their column positions from a chord-only line."""
        chords = []
        for m in re.finditer(r'\S+', chord_line):
            word = m.group(0)
            if _is_chord_word(word):
                chords.append({"position": m.start(), "chord_name": word})
        return chords

    def _map_chords_to_lyrics(self, chord_line: str, lyric_line: str) -> list:
        """
        Map chords from a chord line to positions in the lyric line.
        Chord column positions correspond directly to lyric character columns.
        """
        chord_entries = self._extract_chord_positions(chord_line)
        if not chord_entries:
            return []

        lyric_len = max(len(lyric_line), 1)
        result = []
        last_pos = -1

        for entry in chord_entries:
            pos = entry["position"]
            # Cap at lyric length and ensure strictly increasing
            pos = min(pos, lyric_len - 1)
            if pos <= last_pos:
                pos = last_pos + 1
            # After stripping leading spaces from lyrics, adjust position
            stripped_offset = len(lyric_line) - len(lyric_line.lstrip())
            pos = max(0, pos - stripped_offset)
            pos = min(pos, max(len(lyric_line.strip()) - 1, 0))
            if pos <= last_pos:
                pos = last_pos + 1
            result.append({"position": pos, "chord_name": entry["chord_name"]})
            last_pos = pos

        return result
