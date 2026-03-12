import { memo, useEffect, useRef, useState } from 'react'
import { SVGuitarChord, ChordStyle, type Finger, SILENT } from 'svguitar'
import { ChordPosition, findPreferredVoicingIndex, resolveChordVoicings } from '../utils/chordVoicings'

interface ChordDiagramProps {
  chordName: string
  displayName?: string
  voicingIndex: number
  voicingSignature?: string | null
  voicingChordName?: string | null
  preferenceVersion?: number
  onVoicingChange: (index: number) => void
  compact?: boolean
  onExploreMore?: () => void
}

function inferBarres(position: ChordPosition) {
  const numStrings = position.frets.length
  const candidateFrets = Array.from(new Set((position.barres ?? []).filter((fret) => fret > 0))).sort((a, b) => a - b)

  return candidateFrets.map((barreFret) => {
    const matchingIndexes = position.frets
      .map((fret, stringIndex) => fret === barreFret ? stringIndex : -1)
      .filter((stringIndex) => stringIndex >= 0)

    if (matchingIndexes.length < 2) return null

    let start = Math.min(...matchingIndexes)
    let end = Math.max(...matchingIndexes)

    for (let i = start; i <= end; i += 1) {
      if (position.frets[i] <= 0 || position.frets[i] < barreFret) {
        return null
      }
    }

    while (start > 0 && position.frets[start - 1] > 0 && position.frets[start - 1] >= barreFret) {
      start -= 1
    }
    while (end < position.frets.length - 1 && position.frets[end + 1] > 0 && position.frets[end + 1] >= barreFret) {
      end += 1
    }

    return {
      fret: barreFret,
      fromString: numStrings - start,
      toString: numStrings - end,
    }
  }).filter((value): value is { fret: number; fromString: number; toString: number } => value !== null)
}

function toAbsoluteFrets(position: ChordPosition): number[] {
  return position.frets.map((fret) => {
    if (fret <= 0) return fret
    if (position.baseFret <= 1) return fret
    return position.baseFret + fret - 1
  })
}

function normalizeDisplayPosition(position: ChordPosition): ChordPosition {
  const absoluteFrets = toAbsoluteFrets(position)
  const positiveFrets = absoluteFrets.filter((fret) => fret > 0)
  const hasOpenString = absoluteFrets.some((fret) => fret === 0)
  const maxPositiveFret = positiveFrets.length > 0 ? Math.max(...positiveFrets) : 0
  const shouldRenderFromNut = hasOpenString && maxPositiveFret <= 5

  if (!shouldRenderFromNut) {
    return position
  }

  return {
    ...position,
    frets: absoluteFrets,
    barres: (position.barres ?? []).map((fret) => {
      if (fret <= 0) return fret
      if (position.baseFret <= 1) return fret
      return position.baseFret + fret - 1
    }),
    baseFret: 1,
  }
}

export function renderChordDiagram(container: HTMLElement, position: ChordPosition, chordName: string, compact = false, displayName?: string) {
  container.innerHTML = ''

  const chart = new SVGuitarChord(container)
  const displayPosition = normalizeDisplayPosition(position)

  const fingers: Finger[] = []
  const numStrings = displayPosition.frets.length

  displayPosition.frets.forEach((fret, stringIndex) => {
    const svgString = numStrings - stringIndex

    if (fret > 0) {
      fingers.push([svgString, fret])
      return
    }

    if (fret < 0) {
      fingers.push([svgString, SILENT])
    }
  })

  const barres = inferBarres(displayPosition)

  chart
    .configure({
      strings: 6,
      frets: 5,
      position: displayPosition.baseFret || 1,
      tuning: [],
      style: ChordStyle.normal,
      fixedDiagramPosition: true,
      strokeWidth: compact ? 1.5 : 2,
      fingerSize: 0.35,
      fingerTextSize: compact ? 16 : 22,
      color: '#333',
      emptyStringIndicatorSize: 0.6,
      title: displayName ?? chordName,
      titleFontSize: compact ? 56 : 48,
      fontFamily: 'Arial, sans-serif',
    })
    .chord({
      fingers,
      barres,
    })
    .draw()
}

export function StaticChordDiagram({
  chordName,
  displayName,
  position,
  compact = false,
}: {
  chordName: string
  displayName?: string
  position: ChordPosition
  compact?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    renderChordDiagram(containerRef.current, position, chordName, compact, displayName)
  }, [position, chordName, compact, displayName])

  return (
    <div
      ref={containerRef}
      className={compact ? 'chord-diagram-container chord-diagram-container--compact' : 'chord-diagram-container'}
      style={{ width: compact ? '80px' : '160px', height: compact ? '100px' : '200px' }}
    />
  )
}

function ChordDiagram({
  chordName,
  displayName,
  voicingIndex,
  voicingSignature,
  voicingChordName,
  preferenceVersion = 0,
  onVoicingChange,
  compact = false,
  onExploreMore,
}: ChordDiagramProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<ChordPosition[]>([])
  const [maxResults, setMaxResults] = useState(compact ? 6 : 16)
  const [maxFret, setMaxFret] = useState(18)
  const [isVisible, setIsVisible] = useState(!compact)
  const [resolvedSignatureIndex, setResolvedSignatureIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!compact) {
      setIsVisible(true)
      return
    }

    const node = wrapperRef.current
    if (!node || isVisible) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '240px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [compact, isVisible])

  useEffect(() => {
    if (!isVisible) return

    const preferredIndex = findPreferredVoicingIndex(chordName, voicingSignature, voicingChordName, { maxFret, maxSpan: 5 })
    const requestedResults = Math.max(maxResults, voicingIndex + 1, preferredIndex !== null ? preferredIndex + 1 : 0)
    const pos = resolveChordVoicings(chordName, { maxResults: requestedResults, maxFret, maxSpan: 5 })
    setResolvedSignatureIndex(preferredIndex)
    setPositions(pos)
  }, [chordName, isVisible, maxResults, maxFret, voicingIndex, voicingSignature, voicingChordName, preferenceVersion])

  useEffect(() => {
    setMaxResults(compact ? 6 : 16)
    setMaxFret(18)
    setResolvedSignatureIndex(null)
  }, [chordName, compact])

  const effectiveVoicingIndex = resolvedSignatureIndex ?? voicingIndex

  useEffect(() => {
    if (!isVisible) return
    if (!containerRef.current || positions.length === 0) return

    const safeIndex = Math.min(effectiveVoicingIndex, positions.length - 1)
    const position = positions[safeIndex]

    if (position) {
      renderChordDiagram(containerRef.current, position, chordName, compact, displayName)
    }
  }, [chordName, displayName, effectiveVoicingIndex, positions, compact, isVisible])

  useEffect(() => {
    if (positions.length === 0) return

    const maxIndex = positions.length - 1
    if (effectiveVoicingIndex > maxIndex) {
      onVoicingChange(maxIndex)
    }
  }, [positions, effectiveVoicingIndex, onVoicingChange])

  useEffect(() => {
    if (effectiveVoicingIndex >= maxResults) {
      setMaxResults(effectiveVoicingIndex + 1)
    }
  }, [effectiveVoicingIndex, maxResults])

  const safeIndex = Math.min(effectiveVoicingIndex, Math.max(positions.length - 1, 0))
  const hasMultiple = !compact && positions.length > 1
  const canSearchMore = !compact && Boolean(chordName)

  const width = compact ? 80 : 160
  const height = compact ? 100 : 200
  const noDataHeight = compact ? 80 : 180

  return (
    <div ref={wrapperRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      {isVisible || !compact ? (
        <div
          ref={containerRef}
          className={compact ? 'chord-diagram-container chord-diagram-container--compact' : 'chord-diagram-container'}
          style={{ width: `${width}px`, height: `${height}px` }}
        />
      ) : (
        <div style={{
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: '10px',
          background: 'linear-gradient(135deg, rgba(241,245,249,1) 0%, rgba(226,232,240,0.72) 100%)',
        }} />
      )}
      {isVisible && positions.length === 0 && (
        <div style={{
          width: `${width}px`,
          height: `${noDataHeight}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f5f5',
          border: '1px solid #ddd',
          borderRadius: '8px',
          fontSize: compact ? '11px' : '14px',
          color: '#999',
          textAlign: 'center',
          padding: '8px',
        }}>
          <span>{displayName ?? chordName}<br />No diagram</span>
        </div>
      )}
      {hasMultiple && (
        <div
          style={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <button
            onClick={() => onVoicingChange(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            style={{
              justifySelf: 'stretch',
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              backgroundColor: safeIndex === 0 ? '#f3f4f6' : 'white',
              cursor: safeIndex === 0 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              color: safeIndex === 0 ? '#9ca3af' : '#374151',
            }}
          >
            前へ
          </button>
          <span
            style={{
              fontSize: '12px',
              color: '#4b5563',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {safeIndex + 1} / {positions.length}
          </span>
          <button
            onClick={() => onVoicingChange(Math.min(positions.length - 1, safeIndex + 1))}
            disabled={safeIndex === positions.length - 1}
            style={{
              justifySelf: 'stretch',
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              backgroundColor: safeIndex === positions.length - 1 ? '#f3f4f6' : 'white',
              cursor: safeIndex === positions.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              color: safeIndex === positions.length - 1 ? '#9ca3af' : '#374151',
            }}
          >
            次へ
          </button>
        </div>
      )}
      {canSearchMore && (
        <button
          onClick={() => {
            if (onExploreMore) {
              onExploreMore()
              return
            }
            setMaxResults((prev) => prev + 12)
            setMaxFret(18)
          }}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            backgroundColor: 'white',
            color: '#4b5563',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {onExploreMore ? '候補を一覧表示' : 'もっと候補を探す'}
        </button>
      )}
    </div>
  )
}

export default memo(ChordDiagram)
