const SUFFIX_CANONICAL_MAP: Record<string, string> = {
  'm7-5': 'm7b5',
  'm7♭5': 'm7b5',
  '-7b5': 'm7b5',
  'ø': 'm7b5',
  'half-diminished': 'm7b5',
  'halfdiminished': 'm7b5',
  'halfdim': 'm7b5',
}

function normalizeAccidentals(value: string): string {
  return value
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
}

function normalizeNoteToken(note: string): string {
  const trimmed = normalizeAccidentals(note.trim())
  const match = trimmed.match(/^([A-Ga-g])([#b]?)(.*)$/)
  if (!match) return trimmed

  const [, letter, accidental, rest] = match
  return `${letter.toUpperCase()}${accidental}${rest}`
}

export function normalizeChordName(chordName: string): string {
  if (!chordName) return chordName

  const trimmed = chordName.trim()
  const [symbol, bass] = trimmed.split('/', 2)
  const normalizedSymbol = normalizeNoteToken(symbol)
  const match = normalizedSymbol.match(/^([A-G][#b]?)(.*)$/)
  if (!match) return trimmed

  const [, root, rawSuffix] = match
  const suffix = normalizeAccidentals(rawSuffix).replace(/\s+/g, '')
  const canonicalSuffix = SUFFIX_CANONICAL_MAP[suffix.toLowerCase()] ?? suffix
  const normalizedBass = bass ? normalizeNoteToken(bass) : ''

  return normalizedBass ? `${root}${canonicalSuffix}/${normalizedBass}` : `${root}${canonicalSuffix}`
}
