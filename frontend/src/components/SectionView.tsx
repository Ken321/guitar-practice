import { memo, useMemo } from 'react'
import { Section, DisplayMode, ChordPlacement } from '../types'
import { chordToDegree } from '../utils/degree'
import ChordDiagram from './ChordDiagram'

interface SectionViewProps {
  section: Section
  displayMode: DisplayMode
  songKey: string
  onChordClick: (chord: ChordPlacement, event: React.MouseEvent) => void
}

// monospace font 17px + letter-spacing 1.0em ≈ 27px per character
const CHAR_WIDTH = 27
const DIAGRAM_WIDTH = 80
// paddingLeft so that the first character's center aligns with the diagram's center
// diagram center = DIAGRAM_WIDTH / 2 = 40px
// first char center = paddingLeft + CHAR_WIDTH / 2
// → paddingLeft = 40 - 13.5 = 26.5px
const TEXT_PADDING_LEFT = DIAGRAM_WIDTH / 2 - CHAR_WIDTH / 2

type Segment = { chord: ChordPlacement; text: string }
const NOOP = () => {}

function buildSegments(
  chords: ChordPlacement[],
  lyrics: string,
): { preText: string; segments: Segment[] } {
  const preText = chords.length > 0 ? lyrics.slice(0, chords[0].position) : ''

  const segments: Segment[] = chords.map((chord, i) => {
    const start = chord.position
    const end = i + 1 < chords.length ? chords[i + 1].position : lyrics.length
    return { chord, text: lyrics.slice(start, end) }
  })

  return { preText, segments }
}

const lyricsStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '17px',
  letterSpacing: '1.0em',
  whiteSpace: 'nowrap',
  color: '#333',
  lineHeight: '24px',
  display: 'inline-block',
}

function ChordLine({
  chords,
  lyrics,
  displayMode,
  songKey,
  onChordClick,
}: {
  chords: ChordPlacement[]
  lyrics: string
  displayMode: DisplayMode
  songKey: string
  onChordClick: (chord: ChordPlacement, event: React.MouseEvent) => void
}) {
  const sortedChords = useMemo(
    () => [...chords].sort((a, b) => a.position - b.position),
    [chords],
  )

  const segmentedLine = useMemo(
    () => buildSegments(sortedChords, lyrics),
    [sortedChords, lyrics],
  )

  if (chords.length === 0 && !lyrics) return null

  // No lyrics — instrumental section: diagrams only in a row
  if (!lyrics) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
        {sortedChords.map((chord) => {
          const displayName = displayMode === 'degree'
            ? chordToDegree(chord.chord_name, songKey)
            : chord.chord_name
          return (
            <div
              key={chord.id}
              style={{ cursor: 'pointer' }}
              onClick={(e) => onChordClick(chord, e)}
              title={`${displayName} (クリックで拡大)`}
            >
              <ChordDiagram
                key={displayName}
                chordName={chord.chord_name}
                displayName={displayName}
                voicingIndex={chord.preferred_voicing}
                onVoicingChange={NOOP}
                compact
              />
            </div>
          )
        })}
      </div>
    )
  }

  // Lyrics only — no chords
  if (chords.length === 0) {
    return (
      <div className="chord-line chord-line--lyrics-only" style={{ marginBottom: '20px' }}>
        <span className="chord-line__lyrics chord-line__lyrics--plain" style={lyricsStyle}>{lyrics}</span>
      </div>
    )
  }

  // Lyrics + chords: build segments
  const { preText, segments } = segmentedLine

  return (
    <div
      className="chord-line chord-line--with-chords"
      style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'nowrap', marginBottom: '20px' }}
    >
      {/* Pre-chord text (before first chord): no diagram, aligned to bottom */}
      {preText.length > 0 && (
        <span className="chord-line__pretext" style={lyricsStyle}>{preText}</span>
      )}

      {/* Chord segments */}
      {segments.map((seg) => {
        const displayName = displayMode === 'degree'
          ? chordToDegree(seg.chord.chord_name, songKey)
          : seg.chord.chord_name

        return (
          <div
            key={seg.chord.id}
            className="chord-line__segment"
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              // Minimum width = diagram width so diagrams never overlap
              minWidth: `${DIAGRAM_WIDTH}px`,
              flexShrink: 0,
            }}
          >
            {/* Chord diagram */}
            <div
              style={{ cursor: 'pointer', flexShrink: 0 }}
              onClick={(e) => onChordClick(seg.chord, e)}
              title={`${displayName} (クリックで拡大)`}
            >
              <ChordDiagram
                key={displayName}
                chordName={seg.chord.chord_name}
                displayName={displayName}
                voicingIndex={seg.chord.preferred_voicing}
                onVoicingChange={NOOP}
                compact
              />
            </div>

            {/* Lyrics segment: padded so first char centers under diagram center */}
            <span
              className="chord-line__lyrics"
              style={{
                ...lyricsStyle,
                paddingLeft: `${TEXT_PADDING_LEFT}px`,
              }}
            >
              {seg.text || '\u00A0'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const MemoChordLine = memo(ChordLine)

function SectionView({
  section,
  displayMode,
  songKey,
  onChordClick,
}: SectionViewProps) {
  return (
    <div className="section-view" style={{
      marginBottom: '24px',
      padding: '16px',
    }}>
      {section.label && (
        <div style={{
          fontSize: '13px',
          fontWeight: 'bold',
          color: '#666',
          backgroundColor: '#f0f4f8',
          padding: '4px 10px',
          borderRadius: '4px',
          marginBottom: '12px',
          display: 'inline-block',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}>
          {section.label}
        </div>
      )}
      <div className="section-view__lines" style={{ overflowX: 'auto', paddingBottom: '4px' }}>
        {section.lines.map((line) => (
          <MemoChordLine
            key={line.id}
            chords={line.chords}
            lyrics={line.lyrics}
            displayMode={displayMode}
            songKey={songKey}
            onChordClick={onChordClick}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(SectionView)
