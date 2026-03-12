import { useState } from 'react'
import { SectionCreate, ChordPlacementCreate } from '../types'

interface SongEditorProps {
  sections: SectionCreate[]
  onChange: (sections: SectionCreate[]) => void
}

interface EditingChord {
  lineIdx: number
  chordIdx: number | null
  position: number
  chord_name: string
}

interface DraggingChord {
  lineIdx: number
  chordIdx: number
}

function normalizeChordPositions(chords: ChordPlacementCreate[]): ChordPlacementCreate[] {
  const sortedBasePositions = [...chords]
    .map((chord) => chord.position)
    .sort((a, b) => a - b)

  let lastAssigned = -1
  return chords.map((chord, index) => {
    const desired = sortedBasePositions[index] ?? index * 4
    const nextPosition = desired <= lastAssigned ? lastAssigned + 1 : desired
    lastAssigned = nextPosition
    return {
      ...chord,
      position: nextPosition,
    }
  })
}

function flattenSectionsToLines(sections: SectionCreate[]): SectionCreate['lines'] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .flatMap((section) =>
      [...section.lines]
        .sort((a, b) => a.order - b.order)
        .map((line) => ({
          order: 0,
          lyrics: line.lyrics,
          chords: normalizeChordPositions(
            [...line.chords].sort((a, b) => a.position - b.position),
          ),
        }))
    )
    .map((line, index) => ({
      ...line,
      order: index,
    }))
}

function ensureSingleSection(sections: SectionCreate[]): SectionCreate[] {
  if (sections.length === 0) {
    return [{ order: 0, label: '', lines: [{ order: 0, lyrics: '', chords: [] }] }]
  }

  const mergedLines = flattenSectionsToLines(sections)

  return [{ order: 0, label: '', lines: mergedLines.length > 0 ? mergedLines : [{ order: 0, lyrics: '', chords: [] }] }]
}

export default function SongEditor({ sections, onChange }: SongEditorProps) {
  const normalizedSections = ensureSingleSection(sections)
  const lines = normalizedSections[0].lines

  const [editingChord, setEditingChord] = useState<EditingChord | null>(null)
  const [draggingChord, setDraggingChord] = useState<DraggingChord | null>(null)
  const [dragOverChord, setDragOverChord] = useState<DraggingChord | null>(null)

  function updateLines(updater: (lines: SectionCreate['lines']) => SectionCreate['lines']) {
    const nextLines = updater(lines).map((line, index) => ({ ...line, order: index }))
    onChange([{ order: 0, label: '', lines: nextLines }])
  }

  function addLine() {
    updateLines((prev) => [...prev, { order: prev.length, lyrics: '', chords: [] }])
  }

  function removeLine(lineIdx: number) {
    if (!window.confirm('この行を削除しますか？')) return
    updateLines((prev) => {
      const remaining = prev.filter((_, index) => index !== lineIdx)
      return remaining.length > 0 ? remaining : [{ order: 0, lyrics: '', chords: [] }]
    })
  }

  function updateLineLyrics(lineIdx: number, lyrics: string) {
    updateLines((prev) => prev.map((line, index) => (index === lineIdx ? { ...line, lyrics } : line)))
  }

  function openAddChord(lineIdx: number, position: number) {
    setEditingChord({ lineIdx, chordIdx: null, position, chord_name: '' })
  }

  function openEditChord(lineIdx: number, chordIdx: number) {
    const chord = lines[lineIdx].chords[chordIdx]
    setEditingChord({
      lineIdx,
      chordIdx,
      position: chord.position,
      chord_name: chord.chord_name,
    })
  }

  function saveChord() {
    if (!editingChord || !editingChord.chord_name.trim()) {
      setEditingChord(null)
      return
    }

    const { lineIdx, chordIdx, position, chord_name } = editingChord

    updateLines((prev) =>
      prev.map((line, index) => {
        if (index !== lineIdx) return line

        let nextChords: ChordPlacementCreate[]
        if (chordIdx === null) {
          nextChords = [...line.chords, {
            position,
            chord_name: chord_name.trim(),
            preferred_voicing: 0,
            has_custom_voicing: false,
            preferred_voicing_signature: null,
            preferred_voicing_chord_name: null,
          }]
        } else {
          nextChords = line.chords.map((chord, existingIdx) =>
            existingIdx === chordIdx
              ? chord.chord_name === chord_name.trim()
                ? { ...chord, position, chord_name: chord_name.trim() }
                : {
                  ...chord,
                  position,
                  chord_name: chord_name.trim(),
                  preferred_voicing: 0,
                  has_custom_voicing: false,
                  preferred_voicing_signature: null,
                  preferred_voicing_chord_name: null,
                }
              : chord
          )
        }

        return {
          ...line,
          chords: normalizeChordPositions(
            [...nextChords].sort((a, b) => a.position - b.position),
          ),
        }
      })
    )

    setEditingChord(null)
  }

  function removeChord(lineIdx: number, chordIdx: number) {
    updateLines((prev) =>
      prev.map((line, index) =>
        index === lineIdx
          ? { ...line, chords: line.chords.filter((_, existingIdx) => existingIdx !== chordIdx) }
          : line
      )
    )
  }

  function reorderChords(lineIdx: number, fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return

    updateLines((prev) =>
      prev.map((line, index) => {
        if (index !== lineIdx) return line

        const reordered = [...line.chords]
        const [moved] = reordered.splice(fromIdx, 1)
        reordered.splice(toIdx, 0, moved)

        return {
          ...line,
          chords: normalizeChordPositions(reordered),
        }
      })
    )
  }

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {lines.map((line, lineIdx) => (
        <div key={lineIdx} style={{ marginBottom: '16px', padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minHeight: '32px' }}>
              {line.chords.map((chord, chordIdx) => {
                const isDragging = draggingChord?.lineIdx === lineIdx && draggingChord?.chordIdx === chordIdx
                const isDropTarget = dragOverChord?.lineIdx === lineIdx && dragOverChord?.chordIdx === chordIdx

                return (
                  <span
                    key={`${chord.chord_name}-${chord.position}-${chordIdx}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      setDraggingChord({ lineIdx, chordIdx })
                      setDragOverChord({ lineIdx, chordIdx })
                    }}
                    onDragEnd={() => {
                      setDraggingChord(null)
                      setDragOverChord(null)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      if (!draggingChord || draggingChord.lineIdx !== lineIdx) return
                      setDragOverChord({ lineIdx, chordIdx })
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!draggingChord || draggingChord.lineIdx !== lineIdx) return
                      reorderChords(lineIdx, draggingChord.chordIdx, chordIdx)
                      setDraggingChord(null)
                      setDragOverChord(null)
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 8px',
                      border: `1px solid ${isDropTarget ? 'var(--theme-color-muted)' : 'var(--theme-color-border)'}`,
                      backgroundColor: isDropTarget ? 'var(--theme-color-soft-strong)' : 'var(--theme-color-soft)',
                      color: 'var(--theme-color)',
                      borderRadius: '999px',
                      opacity: isDragging ? 0.45 : 1,
                    }}
                    title="ドラッグで並び替え / クリックで編集"
                  >
                    <button
                      onClick={() => openEditChord(lineIdx, chordIdx)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {chord.chord_name}@{chord.position}
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        removeChord(lineIdx, chordIdx)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--theme-color)',
                        fontSize: '13px',
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      aria-label={`${chord.chord_name} を削除`}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
              <button
                onClick={() => openAddChord(lineIdx, line.chords.length > 0 ? line.chords[line.chords.length - 1].position + 4 : 0)}
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'var(--theme-color-soft)',
                  color: 'var(--theme-color)',
                  border: '1px dashed var(--theme-color-border)',
                  borderRadius: '999px',
                  fontSize: '12px',
                }}
              >
                + コード追加
              </button>
            </div>

            <button
              onClick={() => removeLine(lineIdx)}
              style={{
                width: '28px',
                height: '28px',
                backgroundColor: 'transparent',
                color: '#666',
                border: '1px solid #d1d5db',
                borderRadius: '999px',
                fontSize: '14px',
                lineHeight: 1,
              }}
              aria-label={`行 ${lineIdx + 1} を削除`}
            >
              ×
            </button>
          </div>

          <input
            value={line.lyrics}
            onChange={(event) => updateLineLyrics(lineIdx, event.target.value)}
            placeholder="歌詞"
            style={{
              width: '100%',
              padding: '8px 0',
              border: 'none',
              borderBottom: '1px solid #d1d5db',
              fontSize: '14px',
              fontFamily: 'monospace',
              backgroundColor: 'transparent',
            }}
          />
        </div>
      ))}

      <button
        onClick={addLine}
        style={{
          padding: '8px 14px',
          backgroundColor: 'var(--theme-color-soft)',
          color: 'var(--theme-color)',
          border: '1px dashed var(--theme-color-border)',
          borderRadius: '999px',
          fontSize: '13px',
        }}
      >
        + 行を追加
      </button>

      {editingChord && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              minWidth: '300px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>
              {editingChord.chordIdx === null ? 'コードを追加' : 'コードを編集'}
            </h3>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>コード名</label>
              <input
                autoFocus
                value={editingChord.chord_name}
                onChange={(event) => setEditingChord((prev) => (prev ? { ...prev, chord_name: event.target.value } : null))}
                placeholder="例: Am7, G, Cmaj7"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveChord()
                  if (event.key === 'Escape') setEditingChord(null)
                }}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>歌詞上の位置（文字数）</label>
              <input
                type="number"
                value={editingChord.position}
                onChange={(event) => setEditingChord((prev) => (prev ? { ...prev, position: parseInt(event.target.value, 10) || 0 } : null))}
                min={0}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditingChord(null)}
                style={{ padding: '8px 16px', backgroundColor: 'white', color: '#666', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              >
                キャンセル
              </button>
              <button
                onClick={saveChord}
                style={{ padding: '8px 16px', backgroundColor: 'var(--theme-color)', color: 'var(--theme-color-contrast)', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}
              >
                {editingChord.chordIdx === null ? '追加' : '更新'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
