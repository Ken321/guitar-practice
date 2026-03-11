import { Chord, Note } from 'tonal'
import guitar from '@tombatossals/chords-db/lib/guitar.json'
import { normalizeChordName } from './normalizeChordName'

export interface ChordPosition {
  frets: number[]
  fingers: number[]
  barres: number[]
  baseFret: number
  midi: number[]
  capo?: boolean
}

interface ChordPositionWithMeta extends ChordPosition {
  absoluteFrets: number[]
  source: 'db' | 'generated'
  score: number
  signature: string
  shapeSignature: string
}

export interface ResolveChordVoicingsOptions {
  maxResults?: number
  maxFret?: number
  maxSpan?: number
}

export interface ResolveChordVoicingsAsyncOptions extends ResolveChordVoicingsOptions {
  yieldEveryWindows?: number
}

const guitarChords = (
  guitar as unknown as {
    chords: Record<string, { key: string; suffix: string; positions: ChordPosition[] }[]>
  }
).chords

const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64]
const DEFAULT_MAX_RESULTS = 16
const DEFAULT_MAX_FRET = 12
const DEFAULT_MAX_SPAN = 4
const MAX_CACHE_SIZE = 128

const NOTE_MAP: Record<string, string> = {
  C: 'C',
  'C#': 'Csharp',
  Db: 'Csharp',
  D: 'D',
  'D#': 'Eb',
  Eb: 'Eb',
  E: 'E',
  F: 'F',
  'F#': 'Fsharp',
  Gb: 'Fsharp',
  G: 'G',
  'G#': 'Ab',
  Ab: 'Ab',
  A: 'A',
  'A#': 'Bb',
  Bb: 'Bb',
  B: 'B',
}

const SUFFIX_ALIASES: Record<string, string[]> = {
  '': ['major', 'maj', ''],
  major: ['major', 'maj', ''],
  maj: ['major', 'maj', ''],
  m: ['minor', 'm', 'min'],
  min: ['minor', 'm', 'min'],
  minor: ['minor', 'm', 'min'],
  '5': ['5'],
  '6': ['6'],
  m6: ['m6', 'min6'],
  '7': ['7', 'dom7'],
  m7: ['m7', 'min7', 'minor7'],
  maj7: ['maj7', 'major7', 'maj7#5', 'M7'],
  dim: ['dim', 'diminished'],
  dim7: ['dim7'],
  aug: ['aug', 'augmented'],
  aug7: ['aug7'],
  sus2: ['sus2'],
  sus4: ['sus4', '7sus4'],
  add9: ['add9'],
  '9': ['9'],
  m9: ['m9', 'min9'],
  maj9: ['maj9'],
  '11': ['11'],
  m11: ['m11'],
  maj11: ['maj11'],
  '13': ['13'],
  maj13: ['maj13'],
  m7b5: ['m7b5', 'm7-5', '-7b5', 'ø', 'half-diminished', 'halfdiminished', 'halfdim'],
  alt: ['alt'],
}

interface ChordSpec {
  chromas: Set<number>
  tonicChroma: number | null
  bassChroma: number | null
  hasExplicitBass: boolean
  requiredChromas: Set<number>
  preferredChromas: Set<number>
  thirdChromas: Set<number>
  fifthChromas: Set<number>
  characteristicChromas: Set<number>
  guideChromas: Set<number>
}

interface BarreInfo {
  fret: number
  start: number
  end: number
  length: number
  sameFretBlocks: number
}

interface FingerAssignment {
  feasible: boolean
  fingerCount: number
  usesThumb: boolean
  mainBarre: BarreInfo | null
  extraMiniBarres: BarreInfo[]
  barreSavings: number
}

const rankedVoicingsCache = new Map<string, ChordPosition[]>()

function buildResolveCacheKey(chordName: string, maxFret: number, maxSpan: number): string {
  return `${chordName}::${maxFret}::${maxSpan}`
}

function readRankedVoicingsFromCache(cacheKey: string): ChordPosition[] | null {
  const cached = rankedVoicingsCache.get(cacheKey)
  if (!cached) return null

  rankedVoicingsCache.delete(cacheKey)
  rankedVoicingsCache.set(cacheKey, cached)
  return cached
}

function writeRankedVoicingsToCache(cacheKey: string, positions: ChordPosition[]): ChordPosition[] {
  rankedVoicingsCache.set(cacheKey, positions)

  if (rankedVoicingsCache.size > MAX_CACHE_SIZE) {
    const oldestKey = rankedVoicingsCache.keys().next().value
    if (oldestKey) {
      rankedVoicingsCache.delete(oldestKey)
    }
  }

  return positions
}

function normalizeDbSuffix(suffix: string): string {
  return suffix.replace(/\s+/g, '').toLowerCase()
}

function getDbCandidates(chordName: string): ChordPositionWithMeta[] {
  const normalizedChordName = normalizeChordName(chordName)
  if (!normalizedChordName) return []

  const [symbol] = normalizedChordName.split('/')
  let root = ''
  let suffix = ''

  if (symbol.length >= 2 && (symbol[1] === '#' || symbol[1] === 'b')) {
    root = symbol.slice(0, 2)
    suffix = symbol.slice(2)
  } else {
    root = symbol.slice(0, 1)
    suffix = symbol.slice(1)
  }

  const dbKey = NOTE_MAP[root]
  if (!dbKey || !guitarChords[dbKey]) return []

  const normalizedSuffix = normalizeDbSuffix(suffix)
  const aliases = SUFFIX_ALIASES[normalizedSuffix] ?? [normalizedSuffix]
  const seenSuffixes = new Set(aliases.map(normalizeDbSuffix))

  return guitarChords[dbKey]
    .filter((entry) => seenSuffixes.has(normalizeDbSuffix(entry.suffix)))
    .flatMap((entry) => entry.positions.map((position, index) => {
      const absoluteFrets = toAbsoluteFrets(position)
      return {
        ...position,
        absoluteFrets,
        source: 'db' as const,
        score: 10_000 - index,
        signature: absoluteFrets.join(','),
        shapeSignature: getShapeSignature(absoluteFrets),
      }
    }))
}

function buildChordSpec(chordName: string): ChordSpec | null {
  const chord = Chord.get(normalizeChordName(chordName))
  if (chord.empty || chord.notes.length === 0) return null

  const chromas = new Set(
    chord.notes
      .map((note) => Note.chroma(note))
      .filter((value) => value >= 0)
  )

  if (chromas.size === 0) return null

  const tonicChroma = chord.tonic ? Note.chroma(chord.tonic) : null
  const bassChroma = chord.bass ? Note.chroma(chord.bass) : tonicChroma
  const requiredChromas = new Set<number>()
  const preferredChromas = new Set<number>()
  const thirdChromas = new Set<number>()
  const fifthChromas = new Set<number>()
  const characteristicChromas = new Set<number>()
  const guideChromas = new Set<number>()

  if (bassChroma !== null) {
    requiredChromas.add(bassChroma)
  }

  chord.notes.forEach((note, index) => {
    const chroma = Note.chroma(note)
    const interval = (chord.intervals[index] ?? '').replace(/^-/, '')
    const degreeMatch = interval.match(/\d+/)
    const degree = degreeMatch ? Number.parseInt(degreeMatch[0], 10) : null
    if (chroma < 0) return

    if (
      interval.startsWith('3') ||
      interval.startsWith('4') ||
      interval.startsWith('6') ||
      interval.startsWith('7') ||
      interval.startsWith('9') ||
      interval.startsWith('11') ||
      interval.startsWith('13')
    ) {
      requiredChromas.add(chroma)
    } else {
      preferredChromas.add(chroma)
    }

    if (degree === 3 || degree === 4) {
      thirdChromas.add(chroma)
      characteristicChromas.add(chroma)
      guideChromas.add(chroma)
    } else if (degree === 5) {
      fifthChromas.add(chroma)
    } else if (degree === 7) {
      characteristicChromas.add(chroma)
      guideChromas.add(chroma)
    } else if (degree && ![1, 5, 8].includes(degree)) {
      characteristicChromas.add(chroma)
    }
  })

  if (tonicChroma !== null) {
    preferredChromas.add(tonicChroma)
  }

  if (requiredChromas.size === 0 && tonicChroma !== null) {
    requiredChromas.add(tonicChroma)
  }

  return {
    chromas,
    tonicChroma,
    bassChroma,
    hasExplicitBass: Boolean(chord.bass),
    requiredChromas,
    preferredChromas,
    thirdChromas,
    fifthChromas,
    characteristicChromas,
    guideChromas,
  }
}

function getAllowedFretsForString(openMidi: number, chromas: Set<number>, maxFret: number): number[] {
  const frets: number[] = []
  for (let fret = 0; fret <= maxFret; fret += 1) {
    if (chromas.has((openMidi + fret) % 12)) {
      frets.push(fret)
    }
  }
  return frets
}

function toAbsoluteFrets(position: ChordPosition): number[] {
  return position.frets.map((fret) => {
    if (fret <= 0) return fret
    if (position.baseFret <= 1) return fret
    return position.baseFret + fret - 1
  })
}

function getBarreInfos(relativeFrets: number[]): BarreInfo[] {
  const blocks = getFretBlocks(relativeFrets)
  const distinctFrets = Array.from(new Set(relativeFrets.filter((fret) => fret > 0))).sort((a, b) => a - b)

  return distinctFrets
    .map((fret) => {
      const strings = relativeFrets
        .map((value, stringIndex) => value === fret ? stringIndex : -1)
        .filter((stringIndex) => stringIndex >= 0)

      if (strings.length < 2) return null

      let start = Math.min(...strings)
      let end = Math.max(...strings)

      for (let i = start; i <= end; i += 1) {
        if (relativeFrets[i] <= 0 || relativeFrets[i] < fret) {
          return null
        }
      }

      while (start > 0 && relativeFrets[start - 1] > 0 && relativeFrets[start - 1] >= fret) {
        start -= 1
      }
      while (end < relativeFrets.length - 1 && relativeFrets[end + 1] > 0 && relativeFrets[end + 1] >= fret) {
        end += 1
      }

      return {
        fret,
        start,
        end,
        length: end - start + 1,
        sameFretBlocks: blocks.filter((block) => block.fret === fret).length,
      }
    })
    .filter((value): value is BarreInfo => value !== null)
    .sort((a, b) => a.fret - b.fret)
}

function detectBarres(relativeFrets: number[]): number[] {
  return getBarreInfos(relativeFrets).map((barre) => barre.fret)
}

function getShapeSignature(absoluteFrets: number[]): string {
  const positiveFrets = absoluteFrets.filter((fret) => fret > 0)
  const minPositiveFret = positiveFrets.length > 0 ? Math.min(...positiveFrets) : 1

  return absoluteFrets
    .map((fret) => {
      if (fret <= 0) return String(fret)
      return String(fret - minPositiveFret + 1)
    })
    .join(',')
}

function getFretBlocks(relativeFrets: number[]): Array<{ fret: number; start: number; end: number; length: number }> {
  const blocks: Array<{ fret: number; start: number; end: number; length: number }> = []
  let start = 0

  while (start < relativeFrets.length) {
    const fret = relativeFrets[start]
    let end = start

    while (end + 1 < relativeFrets.length && relativeFrets[end + 1] === fret) {
      end += 1
    }

    if (fret > 0) {
      blocks.push({ fret, start, end, length: end - start + 1 })
    }

    start = end + 1
  }

  return blocks
}

function estimateFingerMetrics(relativeFrets: number[]) {
  const assignment = simulateFingerAssignment(relativeFrets)
  const positiveFrets = relativeFrets.filter((fret) => fret > 0)
  const hasFullBarre = assignment.mainBarre?.length !== undefined && assignment.mainBarre.length >= 5
  const hasPartialBarre =
    Boolean(assignment.mainBarre && assignment.mainBarre.length >= 2 && assignment.mainBarre.length < 5) ||
    assignment.extraMiniBarres.length > 0
  const isolatedOuterBass = relativeFrets[0] > 0 && relativeFrets.slice(1).some((fret) => fret <= 0)

  return {
    fingerCount: assignment.fingerCount,
    barreCount: (assignment.mainBarre ? 1 : 0) + assignment.extraMiniBarres.length,
    barreSavings: assignment.barreSavings,
    hasFullBarre,
    hasPartialBarre,
    isolatedOuterBass,
    usesThumb: assignment.usesThumb,
    feasible: assignment.feasible,
    mainBarre: assignment.mainBarre,
    extraMiniBarres: assignment.extraMiniBarres,
    blocks: getFretBlocks(relativeFrets),
    pressedNoteCount: positiveFrets.length,
  }
}

function simulateFingerAssignment(relativeFrets: number[]): FingerAssignment {
  const positiveFrets = relativeFrets.filter((fret) => fret > 0)
  if (positiveFrets.length === 0) {
    return {
      feasible: true,
      fingerCount: 0,
      usesThumb: false,
      mainBarre: null,
      extraMiniBarres: [],
      barreSavings: 0,
    }
  }

  const blocks = getFretBlocks(relativeFrets)
  const barreInfos = getBarreInfos(relativeFrets)
  const mainBarre = barreInfos[0] ?? null
  const extraMiniBarres = barreInfos.slice(1).filter((barre) => (
    mainBarre !== null &&
    barre.fret > mainBarre.fret &&
    barre.length <= 3 &&
    barre.start >= 3
  ))
  const invalidSecondaryBarre = barreInfos.slice(1).some((barre) => !extraMiniBarres.includes(barre))

  let fingerCount = blocks.length
  const mergedBarres = [mainBarre, ...extraMiniBarres].filter((barre): barre is BarreInfo => barre !== null)
  mergedBarres.forEach((barre) => {
    fingerCount -= Math.max(0, barre.sameFretBlocks - 1)
  })

  let usesThumb = false
  if (fingerCount > 4 && relativeFrets[0] > 0) {
    fingerCount -= 1
    usesThumb = true
  }

  return {
    feasible: !invalidSecondaryBarre && extraMiniBarres.length <= 1 && fingerCount <= 4,
    fingerCount,
    usesThumb,
    mainBarre,
    extraMiniBarres,
    barreSavings: Math.max(0, positiveFrets.length - fingerCount),
  }
}

function countDirectionChanges(values: number[]): number {
  let previousDirection = 0
  let changes = 0

  for (let i = 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1]
    const direction = diff === 0 ? 0 : diff > 0 ? 1 : -1
    if (direction === 0) continue
    if (previousDirection !== 0 && previousDirection !== direction) {
      changes += 1
    }
    previousDirection = direction
  }

  return changes
}

function getTopStringChromas(absoluteFrets: number[]): number[] {
  return absoluteFrets
    .map((fret, stringIndex) => fret >= 0 ? ({ fret, stringIndex, chroma: (OPEN_STRING_MIDI[stringIndex] + fret) % 12 }) : null)
    .filter((value): value is { fret: number; stringIndex: number; chroma: number } => value !== null)
    .filter(({ stringIndex }) => stringIndex >= 3)
    .map(({ chroma }) => chroma)
}

function getSoundingClusters(absoluteFrets: number[]) {
  let clusters = 0
  let maxClusterSize = 0
  let currentCluster = 0

  absoluteFrets.forEach((fret) => {
    if (fret >= 0) {
      if (currentCluster === 0) clusters += 1
      currentCluster += 1
      maxClusterSize = Math.max(maxClusterSize, currentCluster)
    } else {
      currentCluster = 0
    }
  })

  return { clusters, maxClusterSize }
}

function countClearCharacteristicTopNotes(
  absoluteFrets: number[],
  spec: ChordSpec,
  mainBarre: BarreInfo | null,
): number {
  return absoluteFrets
    .map((fret, stringIndex) => fret >= 0 ? ({ fret, stringIndex, chroma: (OPEN_STRING_MIDI[stringIndex] + fret) % 12 }) : null)
    .filter((value): value is { fret: number; stringIndex: number; chroma: number } => value !== null)
    .filter(({ stringIndex, chroma, fret }) => {
      if (stringIndex < 3) return false
      if (!spec.characteristicChromas.has(chroma)) return false
      if (!mainBarre) return true
      return !(fret === mainBarre.fret && stringIndex >= mainBarre.start && stringIndex <= mainBarre.end)
    })
    .length
}

function makeGeneratedPosition(absoluteFrets: number[], score: number): ChordPositionWithMeta {
  const positiveFrets = absoluteFrets.filter((fret) => fret > 0)
  const minPositiveFret = positiveFrets.length > 0 ? Math.min(...positiveFrets) : 1
  const baseFret = minPositiveFret > 1 ? minPositiveFret : 1
  const frets = absoluteFrets.map((fret) => {
    if (fret <= 0) return fret
    if (baseFret === 1) return fret
    return fret - baseFret + 1
  })
  const midi = absoluteFrets
    .map((fret, stringIndex) => fret >= 0 ? OPEN_STRING_MIDI[stringIndex] + fret : null)
    .filter((value): value is number => value !== null)
  const fingers = frets.map((fret) => fret <= 0 ? 0 : fret)

  return {
    frets,
    fingers,
    barres: detectBarres(frets),
    baseFret,
    midi,
    absoluteFrets,
    source: 'generated',
    score,
    signature: absoluteFrets.join(','),
    shapeSignature: getShapeSignature(absoluteFrets),
  }
}

function scoreVoicing(absoluteFrets: number[], spec: ChordSpec): number {
  const played = absoluteFrets
    .map((fret, stringIndex) => fret >= 0 ? ({ fret, stringIndex, midi: OPEN_STRING_MIDI[stringIndex] + fret }) : null)
    .filter((value): value is { fret: number; stringIndex: number; midi: number } => value !== null)

  const uniqueChromas = new Set(played.map((note) => note.midi % 12))
  const openStrings = played.filter((note) => note.fret === 0).length
  const mutedStrings = absoluteFrets.filter((fret) => fret < 0).length
  const positiveFrets = played.map((note) => note.fret).filter((fret) => fret > 0)
  const minPositive = positiveFrets.length > 0 ? Math.min(...positiveFrets) : 0
  const maxPositive = positiveFrets.length > 0 ? Math.max(...positiveFrets) : 0
  const span = positiveFrets.length > 0 ? maxPositive - minPositive : 0
  const bass = played[0]?.midi % 12
  const allNotesCovered = uniqueChromas.size === spec.chromas.size
  const bassMatches = bass !== undefined && bass === spec.bassChroma
  const tonicInBass = bass !== undefined && bass === spec.tonicChroma
  const fingerPressure = played.filter((note) => note.fret > 0).length
  const requiredHits = Array.from(spec.requiredChromas).filter((chroma) => uniqueChromas.has(chroma)).length
  const preferredHits = Array.from(spec.preferredChromas).filter((chroma) => uniqueChromas.has(chroma)).length
  const firstPlayedString = absoluteFrets.findIndex((fret) => fret >= 0)
  const lastPlayedString = absoluteFrets.length - 1 - [...absoluteFrets].reverse().findIndex((fret) => fret >= 0)
  const internalMutedStrings = firstPlayedString === -1
    ? 0
    : absoluteFrets.slice(firstPlayedString, lastPlayedString + 1).filter((fret) => fret < 0).length
  const relativeFrets = makeGeneratedPosition(absoluteFrets, 0).frets
  const fingerMetrics = estimateFingerMetrics(relativeFrets)
  const fretSequence = played.filter((note) => note.fret > 0).map((note) => note.fret)
  const directionChanges = countDirectionChanges(fretSequence)
  const topStringChromas = getTopStringChromas(absoluteFrets)
  const topCharacteristicHits = topStringChromas.filter((chroma) => spec.characteristicChromas.has(chroma)).length
  const topGuideHits = topStringChromas.filter((chroma) => spec.guideChromas.has(chroma)).length
  const clearCharacteristicTopNotes = countClearCharacteristicTopNotes(absoluteFrets, spec, fingerMetrics.mainBarre)
  const bassIsThird = bass !== undefined && spec.thirdChromas.has(bass)
  const bassIsFifth = bass !== undefined && spec.fifthChromas.has(bass)
  const { clusters, maxClusterSize } = getSoundingClusters(absoluteFrets)
  const bassStringIndex = absoluteFrets.findIndex((fret) => fret >= 0)

  let score = 0
  score += uniqueChromas.size * 24
  score += requiredHits * 26
  score += preferredHits * 8
  score += openStrings * 7
  score += topCharacteristicHits * 12
  score += topGuideHits * 10
  score += clearCharacteristicTopNotes * 12
  score += played.length * 3
  score -= mutedStrings * 2
  score -= internalMutedStrings * 10
  score -= span * 9
  score -= minPositive
  score -= Math.max(0, fingerMetrics.fingerCount - 4) * 40
  score -= Math.max(0, fingerPressure - 4) * 2
  score -= directionChanges * 8

  if (allNotesCovered) score += 18
  if (spec.tonicChroma !== null && uniqueChromas.has(spec.tonicChroma)) score += 12
  if (span <= 4) score += 16
  else if (span === 5) score -= 12

  score += fingerMetrics.barreSavings * 8
  if (fingerMetrics.hasFullBarre) score += 16
  else if (fingerMetrics.hasPartialBarre) score += 8
  if (fingerMetrics.usesThumb) score += 4

  if (clusters === 1) score += 18
  else score -= (clusters - 1) * 12
  if (maxClusterSize >= 4) score += 16
  else if (maxClusterSize <= 2) score -= 10

  if (bassMatches) score += spec.hasExplicitBass ? 48 : 28
  else if (spec.hasExplicitBass) score -= 44
  else if (tonicInBass) score += 22
  else if (bassIsThird) score += 10
  else if (bassIsFifth) score += 4
  else score -= 18

  if (spec.hasExplicitBass && (bassStringIndex === 0 || bassStringIndex === 1)) {
    score += 14
  }

  if (fingerMetrics.isolatedOuterBass) {
    score -= 8
  }

  return score
}

function isPlayableVoicing(absoluteFrets: number[], spec: ChordSpec, maxSpan: number): boolean {
  const played = absoluteFrets
    .map((fret, stringIndex) => fret >= 0 ? ({ fret, stringIndex, midi: OPEN_STRING_MIDI[stringIndex] + fret }) : null)
    .filter((value): value is { fret: number; stringIndex: number; midi: number } => value !== null)

  if (played.length < 3) return false

  const positiveFrets = played.map((note) => note.fret).filter((fret) => fret > 0)
  if (positiveFrets.length > 0) {
    const minPositive = Math.min(...positiveFrets)
    const span = Math.max(...positiveFrets) - minPositive
    if (span >= 6) return false
    if (minPositive <= 5 && span > 4) return false
    if (minPositive >= 10 && span > 5) return false
    if (minPositive > 5 && minPositive < 10 && span > Math.min(maxSpan, 4)) return false
  }

  const uniqueChromas = new Set(played.map((note) => note.midi % 12))
  const minUnique = spec.chromas.size >= 4 ? 3 : Math.min(2, spec.chromas.size)
  if (uniqueChromas.size < minUnique) {
    return false
  }

  const requiredHits = Array.from(spec.requiredChromas).filter((chroma) => uniqueChromas.has(chroma)).length
  const minRequiredHits = spec.hasExplicitBass
    ? Math.min(spec.requiredChromas.size, 2)
    : Math.min(spec.requiredChromas.size, spec.chromas.size >= 4 ? 2 : 1)

  if (requiredHits < minRequiredHits) {
    return false
  }

  const relativeFrets = makeGeneratedPosition(absoluteFrets, 0).frets
  const fingerMetrics = estimateFingerMetrics(relativeFrets)
  if (!fingerMetrics.feasible) {
    return false
  }
  if (fingerMetrics.fingerCount > 4 && !fingerMetrics.isolatedOuterBass) {
    return false
  }

  if (fingerMetrics.mainBarre) {
    const lowerFrettedNotesExist = relativeFrets.some((fret) => fret > 0 && fret < fingerMetrics.mainBarre!.fret)
    if (lowerFrettedNotesExist) {
      return false
    }
  }

  const soundingStrings = absoluteFrets.filter((fret) => fret >= 0).length
  const firstPlayedString = absoluteFrets.findIndex((fret) => fret >= 0)
  const lastPlayedString = absoluteFrets.length - 1 - [...absoluteFrets].reverse().findIndex((fret) => fret >= 0)
  const internalMutedStrings = firstPlayedString === -1
    ? 0
    : absoluteFrets.slice(firstPlayedString, lastPlayedString + 1).filter((fret) => fret < 0).length
  if (soundingStrings >= 4 && internalMutedStrings >= 2) {
    return false
  }
  if (soundingStrings <= 2) {
    return false
  }

  const { clusters, maxClusterSize } = getSoundingClusters(absoluteFrets)
  if (clusters >= 3 && maxClusterSize <= 2) {
    return false
  }

  if (spec.hasExplicitBass) {
    const bassChroma = played[0]?.midi % 12
    if (bassChroma !== spec.bassChroma) {
      return false
    }
    if (played.some((note) => note.midi % 12 !== spec.bassChroma && note.midi < played[0].midi)) {
      return false
    }
  }

  return true
}

function searchWindowCandidates(stringFrets: number[], windowStart: number, maxSpan: number): number[] {
  const windowEnd = windowStart === 0 ? maxSpan : windowStart + maxSpan - 1
  return stringFrets.filter((fret) => {
    if (fret === 0) return true
    if (windowStart === 0) return fret <= windowEnd
    return fret >= windowStart && fret <= windowEnd
  })
}

function rankAndMergeCandidates(
  dbCandidates: ChordPositionWithMeta[],
  generatedCandidates: ChordPositionWithMeta[],
  maxResults: number,
): ChordPosition[] {
  const merged: ChordPositionWithMeta[] = []
  const seenShapes = new Set<string>()

  for (const candidate of [...dbCandidates, ...generatedCandidates]) {
    if (seenShapes.has(candidate.shapeSignature)) continue
    seenShapes.add(candidate.shapeSignature)
    merged.push(candidate)
    if (merged.length >= maxResults) break
  }

  return merged.map(({ absoluteFrets: _absoluteFrets, score: _score, source: _source, signature: _signature, shapeSignature: _shapeSignature, ...position }) => position)
}

function rankAllCandidates(
  dbCandidates: ChordPositionWithMeta[],
  generatedCandidates: ChordPositionWithMeta[],
): ChordPosition[] {
  return rankAndMergeCandidates(dbCandidates, generatedCandidates, Number.MAX_SAFE_INTEGER)
}

function filterPlayableCandidates(
  candidates: ChordPositionWithMeta[],
  spec: ChordSpec | null,
  maxSpan: number,
): ChordPositionWithMeta[] {
  if (!spec) return candidates
  return candidates.filter((candidate) => isPlayableVoicing(candidate.absoluteFrets, spec, maxSpan))
}

function generateChordVoicings(
  chordName: string,
  options: ResolveChordVoicingsOptions = {},
): ChordPositionWithMeta[] {
  const maxFret = Math.max(5, options.maxFret ?? DEFAULT_MAX_FRET)
  const maxSpan = Math.max(3, options.maxSpan ?? DEFAULT_MAX_SPAN)
  const spec = buildChordSpec(chordName)
  if (!spec) return []

  const stringOptions = OPEN_STRING_MIDI.map((openMidi) =>
    getAllowedFretsForString(openMidi, spec.chromas, maxFret)
  )

  const bestBySignature = new Map<string, ChordPositionWithMeta>()

  for (let windowStart = 0; windowStart <= maxFret; windowStart += 1) {
    const windowedOptions = stringOptions.map((frets) => searchWindowCandidates(frets, windowStart, maxSpan))
    const current = new Array<number>(OPEN_STRING_MIDI.length).fill(-1)

    const walk = (stringIndex: number) => {
      if (stringIndex === OPEN_STRING_MIDI.length) {
        if (!isPlayableVoicing(current, spec, maxSpan)) return

        const score = scoreVoicing(current, spec)
        const generated = makeGeneratedPosition([...current], score)
        const existing = bestBySignature.get(generated.signature)
        if (!existing || existing.score < generated.score) {
          bestBySignature.set(generated.signature, generated)
        }
        return
      }

      current[stringIndex] = -1
      walk(stringIndex + 1)

      for (const fret of windowedOptions[stringIndex]) {
        current[stringIndex] = fret
        walk(stringIndex + 1)
      }
    }

    walk(0)
  }

  return Array.from(bestBySignature.values()).sort((a, b) => b.score - a.score)
}

export function resolveChordVoicings(
  chordName: string,
  options: ResolveChordVoicingsOptions = {},
): ChordPosition[] {
  const normalizedChordName = normalizeChordName(chordName)
  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS)
  const maxFret = Math.max(5, options.maxFret ?? DEFAULT_MAX_FRET)
  const maxSpan = Math.max(3, options.maxSpan ?? DEFAULT_MAX_SPAN)
  const cacheKey = buildResolveCacheKey(normalizedChordName, maxFret, maxSpan)
  const cached = readRankedVoicingsFromCache(cacheKey)
  if (cached) {
    return cached.slice(0, maxResults)
  }

  const spec = buildChordSpec(normalizedChordName)
  const dbCandidates = filterPlayableCandidates(getDbCandidates(normalizedChordName), spec, maxSpan)
  const generatedCandidates = generateChordVoicings(normalizedChordName, { ...options, maxFret, maxSpan })
  const ranked = rankAllCandidates(dbCandidates, generatedCandidates)
  return writeRankedVoicingsToCache(cacheKey, ranked).slice(0, maxResults)
}

export async function resolveChordVoicingsAsync(
  chordName: string,
  options: ResolveChordVoicingsAsyncOptions = {},
): Promise<ChordPosition[]> {
  const normalizedChordName = normalizeChordName(chordName)
  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS)
  const maxFret = Math.max(5, options.maxFret ?? DEFAULT_MAX_FRET)
  const maxSpan = Math.max(3, options.maxSpan ?? DEFAULT_MAX_SPAN)
  const yieldEveryWindows = Math.max(1, options.yieldEveryWindows ?? 2)
  const cacheKey = buildResolveCacheKey(normalizedChordName, maxFret, maxSpan)
  const cached = readRankedVoicingsFromCache(cacheKey)
  if (cached) {
    return cached.slice(0, maxResults)
  }

  const spec = buildChordSpec(normalizedChordName)
  const dbCandidates = filterPlayableCandidates(getDbCandidates(normalizedChordName), spec, maxSpan)

  if (!spec) {
    const ranked = rankAllCandidates(dbCandidates, [])
    return writeRankedVoicingsToCache(cacheKey, ranked).slice(0, maxResults)
  }

  const stringOptions = OPEN_STRING_MIDI.map((openMidi) =>
    getAllowedFretsForString(openMidi, spec.chromas, maxFret)
  )

  const bestBySignature = new Map<string, ChordPositionWithMeta>()

  for (let windowStart = 0; windowStart <= maxFret; windowStart += 1) {
    const windowedOptions = stringOptions.map((frets) => searchWindowCandidates(frets, windowStart, maxSpan))
    const current = new Array<number>(OPEN_STRING_MIDI.length).fill(-1)

    const walk = (stringIndex: number) => {
      if (stringIndex === OPEN_STRING_MIDI.length) {
        if (!isPlayableVoicing(current, spec, maxSpan)) return

        const score = scoreVoicing(current, spec)
        const generated = makeGeneratedPosition([...current], score)
        const existing = bestBySignature.get(generated.signature)
        if (!existing || existing.score < generated.score) {
          bestBySignature.set(generated.signature, generated)
        }
        return
      }

      current[stringIndex] = -1
      walk(stringIndex + 1)

      for (const fret of windowedOptions[stringIndex]) {
        current[stringIndex] = fret
        walk(stringIndex + 1)
      }
    }

    walk(0)

    if ((windowStart + 1) % yieldEveryWindows === 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
    }
  }

  const generatedCandidates = Array.from(bestBySignature.values()).sort((a, b) => b.score - a.score)
  const ranked = rankAllCandidates(dbCandidates, generatedCandidates)
  return writeRankedVoicingsToCache(cacheKey, ranked).slice(0, maxResults)
}
