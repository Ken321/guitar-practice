import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Song, DisplayMode, SectionCreate, ChordPlacement } from '../types'
import { getSong, updateSong, updateSongContent, updateChordVoicing } from '../api/client'
import SectionView from '../components/SectionView'
import ChordPopover from '../components/ChordPopover'
import SongEditor from '../components/SongEditor'
import { COMMON_KEYS, transposeChord, chordToDegree, transposeKeyName } from '../utils/degree'

interface PopoverState {
  chordId: string
  chordName: string
  displayName?: string
  initialVoicingIndex: number
  position: { x: number; y: number }
}

function songToEditableSections(song: Song): SectionCreate[] {
  const mergedLines = song.sections
    .flatMap((section) => section.lines)
    .sort((a, b) => a.order - b.order)
    .map((line, index) => ({
      order: index,
      lyrics: line.lyrics,
      chords: line.chords.map((chord) => ({
        position: chord.position,
        chord_name: chord.chord_name,
        preferred_voicing: chord.preferred_voicing,
      })),
    }))

  return [{
    order: 0,
    label: '',
    lines: mergedLines.length > 0 ? mergedLines : [{ order: 0, lyrics: '', chords: [] }],
  }]
}

export default function ChordSheet() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [song, setSong] = useState<Song | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('chord')
  const [displayKey, setDisplayKey] = useState<string>('C')
  const [isEditing, setIsEditing] = useState(false)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [saving, setSaving] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftArtist, setDraftArtist] = useState('')
  const [draftOriginalKey, setDraftOriginalKey] = useState('C')
  const [draftCapo, setDraftCapo] = useState(0)
  const [draftSections, setDraftSections] = useState<SectionCreate[]>([])
  const draftChartKey = useMemo(() => transposeKeyName(draftOriginalKey, -draftCapo), [draftOriginalKey, draftCapo])

  useEffect(() => {
    if (id) loadSong(id)
  }, [id])

  async function loadSong(songId: string) {
    try {
      setLoading(true)
      const data = await getSong(songId)
      setSong(data)
      setDisplayKey(data.key)
      setDraftTitle(data.title)
      setDraftArtist(data.artist)
      setDraftOriginalKey(data.original_key)
      setDraftCapo(data.capo)
      setDraftSections(songToEditableSections(data))
    } catch (err) {
      setError('曲の読み込みに失敗しました')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleChordClick = useCallback((chord: ChordPlacement, event: React.MouseEvent) => {
    event.stopPropagation()
    const transposed = transposeChordToKey(chord.chord_name, song?.key || displayKey, displayKey)
    setPopover({
      chordId: chord.id,
      chordName: transposed,
      displayName: displayMode === 'degree' ? chordToDegree(transposed, displayKey) : undefined,
      initialVoicingIndex: chord.preferred_voicing,
      position: { x: event.clientX, y: event.clientY },
    })
  }, [song?.key, displayKey, displayMode])

  async function handleSaveVoicing(chordId: string, voicingIndex: number) {
    if (!id) return

    await updateChordVoicing(id, chordId, voicingIndex)
    setSong((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((section) => ({
          ...section,
          lines: section.lines.map((line) => ({
            ...line,
            chords: line.chords.map((chord) =>
              chord.id === chordId ? { ...chord, preferred_voicing: voicingIndex } : chord
            ),
          })),
        })),
      }
    })
    setPopover((prev) => prev && prev.chordId === chordId
      ? { ...prev, initialVoicingIndex: voicingIndex }
      : prev)
  }

  function transposeChordToKey(chordName: string, originalKey: string, newKey: string): string {
    if (originalKey === newKey) return chordName
    const keyOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const normKey = (k: string) => k.replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#').replace('m', '')
    const origIdx = keyOrder.indexOf(normKey(originalKey))
    const newIdx = keyOrder.indexOf(normKey(newKey))
    if (origIdx === -1 || newIdx === -1) return chordName
    const semitones = (newIdx - origIdx + 12) % 12
    return transposeChord(chordName, semitones)
  }

  const transposedSections = useMemo(() => {
    if (!song) return []
    if (song.key === displayKey) return song.sections

    const keyOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const normKey = (k: string) => k.replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#').replace('m', '')
    const origIdx = keyOrder.indexOf(normKey(song.key))
    const newIdx = keyOrder.indexOf(normKey(displayKey))
    if (origIdx === -1 || newIdx === -1) return song.sections
    const semitones = (newIdx - origIdx + 12) % 12

    return song.sections.map(sec => ({
      ...sec,
      lines: sec.lines.map(line => ({
        ...line,
        chords: line.chords.map(chord => ({
          ...chord,
          chord_name: transposeChord(chord.chord_name, semitones),
        })),
      })),
    }))
  }, [song, displayKey])

  async function handleEditorSave(sections: SectionCreate[], meta: { title: string; artist: string; original_key: string; capo: number }) {
    if (!song || !id) return
    setSaving(true)
    try {
      await updateSong(id, { title: meta.title, artist: meta.artist, original_key: meta.original_key, capo: meta.capo })
      await updateSongContent(id, sections)
      const updated = await getSong(id)
      setSong(updated)
      setDisplayKey(updated.key)
      setIsEditing(false)
    } catch (err) {
      alert('保存に失敗しました')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  function startEditing() {
    if (!song) return
    setDraftTitle(song.title)
    setDraftArtist(song.artist)
    setDraftOriginalKey(song.original_key)
    setDraftCapo(song.capo)
    setDraftSections(songToEditableSections(song))
    setPopover(null)
    setIsEditing(true)
  }

  function cancelEditing() {
    if (!song) {
      setIsEditing(false)
      return
    }
    setDraftTitle(song.title)
    setDraftArtist(song.artist)
    setDraftOriginalKey(song.original_key)
    setDraftCapo(song.capo)
    setDraftSections(songToEditableSections(song))
    setIsEditing(false)
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
        読み込み中...
      </div>
    )
  }

  if (error || !song) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <div style={{ color: '#dc2626', marginBottom: '16px' }}>{error || '曲が見つかりません'}</div>
        <button onClick={() => navigate('/')} style={{ padding: '8px 16px', backgroundColor: 'var(--theme-color)', color: 'var(--theme-color-contrast)', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
          一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className="chord-sheet-page" style={{ padding: '16px' }}>
      {/* Top bar */}
      <div className="chord-sheet-toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '16px',
        position: isEditing ? 'sticky' : 'static',
        top: isEditing ? 0 : undefined,
        zIndex: isEditing ? 20 : undefined,
        backgroundColor: isEditing ? '#f5f5f5' : 'transparent',
        borderBottom: isEditing ? '1px solid #e5e7eb' : 'none',
        marginBottom: '16px',
      }}>
        {isEditing ? (
          <>
            <div className="chord-sheet-controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', flex: 1, minWidth: '320px' }}>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="曲名"
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', backgroundColor: 'white', color: 'var(--theme-color)' }}
              />
              <input
                value={draftArtist}
                onChange={(event) => setDraftArtist(event.target.value)}
                placeholder="アーティスト名"
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: 'white' }}
              />
              <select
                value={draftOriginalKey}
                onChange={(event) => setDraftOriginalKey(event.target.value)}
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: 'white' }}
              >
                {COMMON_KEYS.map((keyOption) => (
                  <option key={keyOption} value={keyOption}>原曲キー: {keyOption}</option>
                ))}
              </select>
              <input
                value={draftChartKey}
                readOnly
                placeholder="譜面キー"
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: '#f9fafb', color: '#555' }}
              />
              <input
                type="number"
                min={0}
                max={12}
                value={draftCapo}
                onChange={(event) => setDraftCapo(Math.max(0, Math.min(12, Number(event.target.value) || 0)))}
                placeholder="カポ"
                style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: 'white' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
              <button
                onClick={cancelEditing}
                disabled={saving}
                style={{ padding: '8px 16px', backgroundColor: 'white', color: '#555', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
              >
                キャンセル
              </button>
              <button
                onClick={() => handleEditorSave(draftSections, { title: draftTitle, artist: draftArtist, original_key: draftOriginalKey, capo: draftCapo })}
                disabled={saving || !draftTitle.trim() || !draftArtist.trim()}
                style={{
                  padding: '8px 18px',
                  backgroundColor: saving || !draftTitle.trim() || !draftArtist.trim() ? 'var(--theme-color-muted)' : 'var(--theme-color)',
                  color: 'var(--theme-color-contrast)',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => navigate('/')}
              style={{ padding: '6px 12px', backgroundColor: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
            >
              ← 戻る
            </button>

            <div className="chord-sheet-title" style={{ flex: 1, minWidth: '200px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--theme-color)', lineHeight: 1.2 }}>
                {song.title}
              </h1>
              <div style={{ fontSize: '14px', color: '#666' }}>
                {song.artist} ・ 原曲キー {song.original_key} ・ 譜面キー {song.key} ・ カポ {song.capo}
              </div>
            </div>

            <div className="chord-sheet-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: '#666' }}>キー:</label>
                <select
                  value={displayKey}
                  onChange={e => setDisplayKey(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', backgroundColor: 'white' }}
                >
                  {COMMON_KEYS.map(k => (
                    <option key={k} value={k}>
                      {k}{k === song.key ? ' (譜面)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{
                display: 'flex',
                border: '1px solid #ddd',
                borderRadius: '6px',
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => setDisplayMode('chord')}
                  style={{
                    padding: '6px 14px',
                    backgroundColor: displayMode === 'chord' ? 'var(--theme-color)' : 'white',
                    color: displayMode === 'chord' ? 'var(--theme-color-contrast)' : '#555',
                    border: 'none',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  コード名
                </button>
                <button
                  onClick={() => setDisplayMode('degree')}
                  style={{
                    padding: '6px 14px',
                    backgroundColor: displayMode === 'degree' ? 'var(--theme-color)' : 'white',
                    color: displayMode === 'degree' ? 'var(--theme-color-contrast)' : '#555',
                    border: 'none',
                    borderLeft: '1px solid #ddd',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  度数
                </button>
              </div>

              <button
                onClick={startEditing}
                style={{
                  padding: '6px 16px',
                  backgroundColor: 'var(--theme-color-soft)',
                  color: 'var(--theme-color)',
                  border: '1px solid var(--theme-color-border)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                編集
              </button>
            </div>
          </>
        )}
      </div>

      {/* Source URL */}
      {song.source_url && (
        <div className="chord-sheet-source" style={{ marginBottom: '12px', fontSize: '12px', color: '#999' }}>
          ソース: <a href={song.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--theme-color)' }}>{song.source_url}</a>
        </div>
      )}

      {/* Editor or Chord Sheet */}
      {isEditing ? (
        <div>
          <SongEditor
            sections={draftSections}
            onChange={setDraftSections}
          />
          {saving && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
              <div style={{ backgroundColor: 'white', padding: '24px 32px', borderRadius: '8px', fontSize: '16px' }}>
                保存中...
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          {transposedSections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#999', backgroundColor: 'white' }}>
              コードシートがまだありません。「編集」ボタンから追加してください。
            </div>
          ) : (
            transposedSections.map(section => (
              <SectionView
                key={section.id}
                section={section}
                displayMode={displayMode}
                songKey={displayKey}
                onChordClick={handleChordClick}
              />
            ))
          )}
        </div>
      )}

      {/* Chord Popover */}
      {popover && (
        <ChordPopover
          chordName={popover.chordName}
          displayName={popover.displayName}
          initialVoicingIndex={popover.initialVoicingIndex}
          position={popover.position}
          onSaveVoicing={(voicingIndex) => handleSaveVoicing(popover.chordId, voicingIndex)}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
