import { Note, Interval, Chord } from 'tonal'
import { normalizeChordName } from './normalizeChordName'

const ROMAN_NUMERALS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ']

const SEMITONES_TO_DEGREE: Record<number, { degree: number; accidental: string }> = {
  0:  { degree: 1, accidental: '' },    // Ⅰ
  1:  { degree: 2, accidental: '♭' },   // ♭Ⅱ
  2:  { degree: 2, accidental: '' },    // Ⅱ
  3:  { degree: 3, accidental: '♭' },   // ♭Ⅲ
  4:  { degree: 3, accidental: '' },    // Ⅲ
  5:  { degree: 4, accidental: '' },    // Ⅳ
  6:  { degree: 5, accidental: '♭' },   // ♭Ⅴ
  7:  { degree: 5, accidental: '' },    // Ⅴ
  8:  { degree: 6, accidental: '♭' },   // ♭Ⅵ
  9:  { degree: 6, accidental: '' },    // Ⅵ
  10: { degree: 7, accidental: '♭' },   // ♭Ⅶ
  11: { degree: 7, accidental: '' },    // Ⅶ
}

/**
 * Convert a chord name to Roman numeral degree notation relative to a key.
 *
 * Examples:
 *   chordToDegree("C", "C")    → "Ⅰ"
 *   chordToDegree("Am7", "C")  → "Ⅵm7"
 *   chordToDegree("G7", "C")   → "Ⅴ7"
 *   chordToDegree("Bb", "C")   → "♭Ⅶ"
 *   chordToDegree("F#m", "D")  → "Ⅲm"
 */
export function chordToDegree(chordName: string, key: string): string {
  if (!chordName || !key) return chordName
  const normalizedChordName = normalizeChordName(chordName)

  // Parse the chord to get its root note
  const chord = Chord.get(normalizedChordName)
  if (!chord || !chord.tonic) return chordName

  const chordRoot = chord.tonic
  const chordType = chord.aliases[0] || chord.type || ''

  // Get the key root (strip minor 'm' suffix if present)
  const keyRoot = key.replace(/m$/, '')

  // Calculate semitone distance from key root to chord root
  const keyPc = Note.get(keyRoot)
  const chordPc = Note.get(chordRoot)

  if (keyPc.chroma == null) return chordName
  if (chordPc.chroma == null) return chordName

  // Get interval in semitones (0-11)
  let semitones = (chordPc.chroma! - keyPc.chroma! + 12) % 12

  const degreeInfo = SEMITONES_TO_DEGREE[semitones]
  if (!degreeInfo) return chordName

  const roman = ROMAN_NUMERALS[degreeInfo.degree - 1]

  // Build the quality suffix from chord type
  // Map chord type to display quality
  let quality = ''
  const lowerType = chordType.toLowerCase()

  if (lowerType === 'major' || lowerType === 'maj' || lowerType === '' || lowerType === 'M') {
    quality = ''
  } else if (lowerType === 'minor' || lowerType === 'min' || lowerType === 'm') {
    quality = 'm'
  } else if (lowerType === 'dominant seventh' || lowerType === '7') {
    quality = '7'
  } else if (lowerType === 'minor seventh' || lowerType === 'm7' || lowerType === 'minor 7th') {
    quality = 'm7'
  } else if (lowerType === 'major seventh' || lowerType === 'maj7' || lowerType === 'M7') {
    quality = 'M7'
  } else if (lowerType === 'diminished' || lowerType === 'dim') {
    quality = 'dim'
  } else if (lowerType === 'augmented' || lowerType === 'aug') {
    quality = 'aug'
  } else if (lowerType === 'suspended fourth' || lowerType === 'sus4') {
    quality = 'sus4'
  } else if (lowerType === 'suspended second' || lowerType === 'sus2') {
    quality = 'sus2'
  } else if (lowerType === 'add ninth' || lowerType === 'add9') {
    quality = 'add9'
  } else {
    // Try to extract the quality from the original chord name after the root
    const rootLen = chordRoot.length
    quality = normalizedChordName.slice(rootLen)
    // Remove any /bass notation
    const slashIdx = quality.indexOf('/')
    if (slashIdx !== -1) quality = quality.slice(0, slashIdx)
  }

  // Handle slash chords - just show the main degree
  const slashIdx = normalizedChordName.indexOf('/')
  let bassNote = ''
  if (slashIdx !== -1) {
    // Optionally indicate the bass note as a degree too
    const bassRoot = normalizedChordName.slice(slashIdx + 1)
    const bassPc = Note.get(bassRoot)
    if (bassPc.chroma !== undefined) {
      const bassSemitones = (bassPc.chroma - keyPc.chroma! + 12) % 12
      const bassDegreeInfo = SEMITONES_TO_DEGREE[bassSemitones]
      if (bassDegreeInfo) {
        bassNote = '/' + bassDegreeInfo.accidental + ROMAN_NUMERALS[bassDegreeInfo.degree - 1]
      }
    }
  }

  return `${degreeInfo.accidental}${roman}${quality}${bassNote}`
}

/**
 * Transpose a chord name by a number of semitones.
 */
export function transposeChord(chordName: string, semitones: number): string {
  if (semitones === 0) return chordName
  const normalizedChordName = normalizeChordName(chordName)
  const chord = Chord.get(normalizedChordName)
  if (!chord || !chord.tonic) return chordName

  const newRoot = Note.transpose(chord.tonic + '4', Interval.fromSemitones(semitones))
  const newRootPc = Note.pitchClass(newRoot)

  // Build new chord name
  const rootLen = chord.tonic.length
  const suffix = normalizedChordName.slice(rootLen)

  return newRootPc + suffix
}

export function transposeKeyName(key: string, semitones: number): string {
  if (!key || semitones === 0) return key
  const isMinor = key.endsWith('m')
  const root = isMinor ? key.slice(0, -1) : key
  const note = Note.get(root)
  if (note.chroma == null) return key

  const transposed = Note.transpose(root + '4', Interval.fromSemitones(semitones))
  const pitchClass = Note.pitchClass(transposed)
  return isMinor ? `${pitchClass}m` : pitchClass
}

/**
 * Get all common key names.
 */
export const COMMON_KEYS = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#',
  'F', 'Bb', 'Eb', 'Ab', 'Db',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m',
  'Dm', 'Gm', 'Cm', 'Fm', 'Bbm'
]

// Chromatic order (index == chroma value)
const CHROMATIC_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const CHROMATIC_MINOR = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

/** Returns the chroma (0-11) of a key name, or null if unrecognised. */
export function getKeyChroma(key: string): number | null {
  if (!key) return null
  const root = key.endsWith('m') ? key.slice(0, -1) : key
  const chroma = Note.get(root).chroma
  return chroma ?? null
}

/**
 * Returns 12 keys in chromatic (semitone) order starting from startKey,
 * preserving the major/minor mode of startKey.
 */
export function getChromaticKeysFrom(startKey: string): string[] {
  const isMinor = startKey.endsWith('m')
  const chromatic = isMinor ? CHROMATIC_MINOR : CHROMATIC_MAJOR
  const chroma = getKeyChroma(startKey)
  if (chroma == null) return chromatic
  return [...chromatic.slice(chroma), ...chromatic.slice(0, chroma)]
}
