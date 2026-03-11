from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass


NOTE_TO_SEMITONE = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "Fb": 4,
    "E#": 5,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}

SEMITONE_TO_KEY_NAME = {
    0: "C",
    1: "Db",
    2: "D",
    3: "Eb",
    4: "E",
    5: "F",
    6: "F#",
    7: "G",
    8: "Ab",
    9: "A",
    10: "Bb",
    11: "B",
}

CHORD_ROOT_RE = re.compile(r"^([A-G])([#b]?)(.*)$")


@dataclass(frozen=True)
class ParsedChord:
    root: int
    quality: str
    original_name: str


def normalize_key_name(key: str | None) -> str | None:
    if not key:
        return None

    value = key.strip()
    match = re.match(r"^([A-G])([#b]?)(m?)$", value)
    if not match:
        return None

    root = NOTE_TO_SEMITONE.get(match.group(1) + match.group(2))
    if root is None:
        return None

    suffix = "m" if match.group(3) == "m" else ""
    return SEMITONE_TO_KEY_NAME[root] + suffix


def normalize_capo_value(capo: int | None) -> int:
    if capo is None:
        return 0
    return max(0, min(int(capo), 12))


def parse_capo_text(text: str | None) -> int | None:
    if not text:
        return None

    normalized = text.replace("－", "-").replace("−", "-").strip()
    if not normalized:
        return None

    if re.search(r"(なし|なしです|no\s*capo|capo\s*0|カポ\s*0)", normalized, re.IGNORECASE):
        return 0

    match = re.search(r"(?:capo|カポ)\s*[:：=]?\s*(\d{1,2})", normalized, re.IGNORECASE)
    if match:
        return normalize_capo_value(int(match.group(1)))

    match = re.search(r"\b(\d{1,2})\b", normalized)
    if match:
        return normalize_capo_value(int(match.group(1)))

    return None


def transpose_note(root: int, semitones: int) -> int:
    return (root + semitones) % 12


def transpose_key_name(key: str, semitones: int) -> str | None:
    normalized = normalize_key_name(key)
    if not normalized:
        return None

    is_minor = normalized.endswith("m")
    root_name = normalized[:-1] if is_minor else normalized
    root = NOTE_TO_SEMITONE[root_name]
    transposed = SEMITONE_TO_KEY_NAME[transpose_note(root, semitones)]
    return f"{transposed}m" if is_minor else transposed


def derive_chart_key(original_key: str | None, capo: int = 0) -> str | None:
    normalized = normalize_key_name(original_key)
    if not normalized:
        return None
    return transpose_key_name(normalized, -normalize_capo_value(capo))


def derive_original_key(chart_key: str | None, capo: int = 0) -> str | None:
    normalized = normalize_key_name(chart_key)
    if not normalized:
        return None
    return transpose_key_name(normalized, normalize_capo_value(capo))


def resolve_song_keys(
    chart_key: str | None,
    original_key: str | None,
    capo: int = 0,
) -> tuple[str | None, str | None]:
    normalized_original = normalize_key_name(original_key)
    normalized_chart = normalize_key_name(chart_key)
    normalized_capo = normalize_capo_value(capo)

    if normalized_original:
        derived_chart = derive_chart_key(normalized_original, normalized_capo)
        return derived_chart, normalized_original

    if normalized_chart:
        derived_original = derive_original_key(normalized_chart, normalized_capo)
        return normalized_chart, derived_original

    return None, None


def parse_chord_name(chord_name: str) -> ParsedChord | None:
    value = chord_name.strip()
    if not value:
        return None

    symbol = value.split("/", 1)[0]
    match = CHORD_ROOT_RE.match(symbol)
    if not match:
        return None

    root_name = match.group(1) + match.group(2)
    root = NOTE_TO_SEMITONE.get(root_name)
    if root is None:
        return None

    suffix = match.group(3).lower()
    quality = "major"
    if suffix.startswith(("maj", "add", "sus", "aug", "6", "7", "9", "11", "13")):
        quality = "major"
    elif suffix.startswith(("dim", "o")) or "m7b5" in suffix or "ø" in suffix:
        quality = "diminished"
    elif suffix.startswith("m") or suffix.startswith("min") or suffix.startswith("-"):
        quality = "minor"

    return ParsedChord(root=root, quality=quality, original_name=chord_name)


def extract_parsed_chords(sections: list[dict], capo: int = 0) -> list[ParsedChord]:
    semitones = normalize_capo_value(capo)
    parsed: list[ParsedChord] = []

    for section in sections or []:
        for line in section.get("lines", []):
            for chord in line.get("chords", []):
                parsed_chord = parse_chord_name(chord.get("chord_name", ""))
                if not parsed_chord:
                    continue
                parsed.append(
                    ParsedChord(
                        root=transpose_note(parsed_chord.root, semitones),
                        quality=parsed_chord.quality,
                        original_name=parsed_chord.original_name,
                    )
                )

    return parsed


def estimate_key_from_sections(sections: list[dict], capo: int = 0, fallback: str | None = None) -> str | None:
    chords = extract_parsed_chords(sections, capo=capo)
    if not chords:
        return normalize_key_name(fallback)

    best_key: str | None = None
    best_score: float | None = None
    fallback_key = normalize_key_name(fallback)

    for root in range(12):
        for mode in ("major", "minor"):
            score = score_key_candidate(chords, root, mode)
            candidate = SEMITONE_TO_KEY_NAME[root] + ("m" if mode == "minor" else "")

            if fallback_key == candidate:
                score += 0.35

            if best_score is None or score > best_score:
                best_score = score
                best_key = candidate

    return best_key or fallback_key


def score_key_candidate(chords: list[ParsedChord], tonic: int, mode: str) -> float:
    diatonic = MAJOR_DIATONIC if mode == "major" else MINOR_DIATONIC
    borrowed = MAJOR_BORROWED if mode == "major" else MINOR_BORROWED
    tonic_quality = "major" if mode == "major" else "minor"
    dominant_root = (tonic + 7) % 12
    leading_root = (tonic + 11) % 12 if mode == "major" else (tonic + 2) % 12

    root_counts = Counter(chord.root for chord in chords)
    score = 0.0

    for index, chord in enumerate(chords):
        degree = (chord.root - tonic) % 12

        if degree in diatonic:
            expected = diatonic[degree]
            score += 3.0 if chord.quality == expected else -1.0
        elif degree in borrowed:
            expected = borrowed[degree]
            score += 0.8 if chord.quality == expected else -0.15
        else:
            score -= 0.8

        if chord.root == tonic:
            score += 2.0 if chord.quality == tonic_quality else 0.5
            if index == 0:
                score += 1.8
            if index == len(chords) - 1:
                score += 2.0

        if chord.root == dominant_root:
            score += 0.4
            if chord.quality == "major":
                score += 0.6

        if chord.root == leading_root and chord.quality == "diminished":
            score += 0.6

    if len(chords) >= 2:
        for prev, curr in zip(chords, chords[1:]):
            prev_degree = (prev.root - tonic) % 12
            curr_degree = (curr.root - tonic) % 12

            if mode == "major" and prev_degree == 7 and curr_degree == 0:
                score += 1.8
            elif mode == "minor" and prev_degree in (7, 10) and curr_degree == 0:
                score += 1.5

            if prev_degree == 5 and curr_degree in (7, 0):
                score += 0.35

    score += root_counts[tonic] * 0.4
    return score


MAJOR_DIATONIC = {
    0: "major",
    2: "minor",
    4: "minor",
    5: "major",
    7: "major",
    9: "minor",
    11: "diminished",
}

MAJOR_BORROWED = {
    3: "major",
    8: "major",
    10: "major",
}

MINOR_DIATONIC = {
    0: "minor",
    2: "diminished",
    3: "major",
    5: "minor",
    7: "minor",
    8: "major",
    10: "major",
}

MINOR_BORROWED = {
    7: "major",
    11: "diminished",
}
