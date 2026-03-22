import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Song, DisplayMode, SectionCreate, ChordPlacement } from '../types'
import { getSong, getVoicingPreferences, updateSong, updateSongContent, updateChordVoicing, invalidateVoicingPreferencesCache, estimateKey } from '../api/client'
import SectionView from '../components/SectionView'
import ChordPopover from '../components/ChordPopover'
import SongEditor from '../components/SongEditor'
import { COMMON_KEYS, transposeChord, chordToDegree, transposeKeyName, getChromaticKeysFrom, getKeyChroma } from '../utils/degree'
import {
  findPreferredVoicingIndex,
  getVoicingPreferenceVersion,
  hydrateVoicingPreferences,
  recordVoicingPreference,
} from '../utils/chordVoicings'

interface PopoverState {
  chordId: string
  chordName: string
  displayName?: string
  initialVoicingIndex: number
  initialVoicingSignature?: string | null
  initialVoicingChordName?: string | null
  position: { x: number; y: number }
}

interface SongLevelVoicingPreference {
  preferred_voicing: number
  preferred_voicing_signature?: string | null
  preferred_voicing_chord_name?: string | null
}

function flattenSectionsToLines(sections: Song['sections']): SectionCreate['lines'] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .flatMap((section) =>
      [...section.lines]
        .sort((a, b) => a.order - b.order)
        .map((line) => ({
          order: 0,
          lyrics: line.lyrics,
          chords: [...line.chords]
            .sort((a, b) => a.position - b.position)
            .map((chord) => ({
              position: chord.position,
              chord_name: chord.chord_name,
              preferred_voicing: chord.preferred_voicing,
              has_custom_voicing: chord.has_custom_voicing,
              preferred_voicing_signature: chord.preferred_voicing_signature ?? null,
              preferred_voicing_chord_name: chord.preferred_voicing_chord_name ?? null,
            })),
        }))
    )
    .map((line, index) => ({
      ...line,
      order: index,
    }))
}

function songToEditableSections(song: Song): SectionCreate[] {
  const mergedLines = flattenSectionsToLines(song.sections)

  return [{
    order: 0,
    label: '',
    lines: mergedLines.length > 0 ? mergedLines : [{ order: 0, lyrics: '', chords: [] }],
  }]
}

function findChordPlacementById(song: Song, chordId: string): ChordPlacement | null {
  for (const section of song.sections) {
    for (const line of section.lines) {
      for (const chord of line.chords) {
        if (chord.id === chordId) {
          return chord
        }
      }
    }
  }

  return null
}

function buildSongLevelVoicingPreferenceMap(song: Song): Map<string, SongLevelVoicingPreference> {
  const candidatesByChordName = new Map<string, Map<string, { count: number; preference: SongLevelVoicingPreference }>>()

  song.sections.forEach((section) => {
    section.lines.forEach((line) => {
      line.chords.forEach((chord) => {
        if (!chord.has_custom_voicing) return

        const preferenceKey = [
          chord.preferred_voicing,
          chord.preferred_voicing_signature ?? '',
          chord.preferred_voicing_chord_name ?? '',
        ].join('::')
        const candidates = candidatesByChordName.get(chord.chord_name) ?? new Map<string, { count: number; preference: SongLevelVoicingPreference }>()
        const existing = candidates.get(preferenceKey)

        candidates.set(preferenceKey, {
          count: (existing?.count ?? 0) + 1,
          preference: {
            preferred_voicing: chord.preferred_voicing,
            preferred_voicing_signature: chord.preferred_voicing_signature ?? null,
            preferred_voicing_chord_name: chord.preferred_voicing_chord_name ?? null,
          },
        })
        candidatesByChordName.set(chord.chord_name, candidates)
      })
    })
  })

  return new Map(
    Array.from(candidatesByChordName.entries()).flatMap(([chordName, candidates]) => {
      const selected = Array.from(candidates.values()).sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count
        return b.preference.preferred_voicing - a.preference.preferred_voicing
      })[0]

      return selected ? [[chordName, selected.preference] as const] : []
    }),
  )
}

function applyEffectiveVoicingPreference(
  chord: ChordPlacement,
  songLevelPreference: SongLevelVoicingPreference | undefined,
): ChordPlacement {
  if (chord.has_custom_voicing) {
    return chord
  }

  if (songLevelPreference) {
    return {
      ...chord,
      preferred_voicing: songLevelPreference.preferred_voicing,
      preferred_voicing_signature: songLevelPreference.preferred_voicing_signature ?? null,
      preferred_voicing_chord_name: songLevelPreference.preferred_voicing_chord_name ?? null,
    }
  }

  return {
    ...chord,
    preferred_voicing: 0,
    preferred_voicing_signature: null,
    preferred_voicing_chord_name: null,
  }
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
  const [isEstimatingKey, setIsEstimatingKey] = useState(false)
  const [voicingPreferenceVersion, setVoicingPreferenceVersion] = useState(getVoicingPreferenceVersion())
  const [draftTitle, setDraftTitle] = useState('')
  const [draftArtist, setDraftArtist] = useState('')
  const [draftOriginalKey, setDraftOriginalKey] = useState('C')
  const [draftCapo, setDraftCapo] = useState(0)
  const [draftSections, setDraftSections] = useState<SectionCreate[]>([])
  const draftChartKey = useMemo(() => transposeKeyName(draftOriginalKey, -draftCapo), [draftOriginalKey, draftCapo])
  const chromaticKeys = useMemo(() => song ? getChromaticKeysFrom(song.key) : COMMON_KEYS, [song])

  // Auto-scroll: level 1 = 1 px/s, level 10 = 50 px/s (linear)
  const [isAutoScrolling, setIsAutoScrolling] = useState(false)
  const [scrollLevel, setScrollLevel] = useState(5)
  const scrollSpeed = 1 + (scrollLevel - 1) * (49 / 9)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const accumulatedScrollRef = useRef<number>(0)

  useEffect(() => {
    if (!isAutoScrolling) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      lastTimeRef.current = null
      accumulatedScrollRef.current = 0
      return
    }

    function step(timestamp: number) {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp
      }
      const delta = timestamp - lastTimeRef.current
      lastTimeRef.current = timestamp

      const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 1
      if (atBottom) {
        setIsAutoScrolling(false)
        return
      }

      // Accumulate fractional pixels so sub-pixel speeds actually work
      accumulatedScrollRef.current += scrollSpeed * (delta / 1000)
      const pixels = Math.floor(accumulatedScrollRef.current)
      if (pixels >= 1) {
        window.scrollBy(0, pixels)
        accumulatedScrollRef.current -= pixels
      }

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isAutoScrolling, scrollSpeed])

  useEffect(() => {
    if (id) loadSong(id)
  }, [id])

  useEffect(() => {
    let cancelled = false

    async function loadPreferences() {
      try {
        const preferences = await getVoicingPreferences()
        if (!cancelled) {
          setVoicingPreferenceVersion(hydrateVoicingPreferences(preferences))
        }
      } catch (err) {
        console.error(err)
      }
    }

    loadPreferences()

    return () => {
      cancelled = true
    }
  }, [])

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
    // Always use the original chord name (from song.sections) for voicing lookup and save.
    // chord.chord_name here comes from transposedSections and may be transposed;
    // findChordPlacementById returns the chord from song.sections with the original name.
    const originalChordName = (song ? findChordPlacementById(song, chord.id) : null)?.chord_name ?? chord.chord_name
    const resolvedInitialVoicingIndex = findPreferredVoicingIndex(
      originalChordName,
      chord.preferred_voicing_signature,
      chord.preferred_voicing_chord_name,
      { maxFret: 18, maxSpan: 5 },
    ) ?? chord.preferred_voicing

    // Build display name: degree label if degree mode, transposed chord name if key differs, otherwise undefined
    let displayName: string | undefined
    if (displayMode === 'degree') {
      displayName = chordToDegree(chord.chord_name, displayKey)
    } else if (chord.chord_name !== originalChordName) {
      displayName = chord.chord_name
    }

    setPopover({
      chordId: chord.id,
      chordName: originalChordName,
      displayName,
      initialVoicingIndex: resolvedInitialVoicingIndex,
      initialVoicingSignature: chord.preferred_voicing_signature,
      initialVoicingChordName: chord.preferred_voicing_chord_name,
      position: { x: event.clientX, y: event.clientY },
    })
  }, [displayKey, displayMode, song, voicingPreferenceVersion])

  async function handleSaveVoicing(
    chordId: string,
    voicingIndex: number,
    voicingSignature?: string | null,
    voicingChordName?: string | null,
  ) {
    if (!id || !song) return

    const primaryChord = findChordPlacementById(song, chordId)
    const targetChordName = primaryChord?.chord_name

    // Propagate to all chords with the same chord_name in the song
    const allSameNameChordIds = targetChordName
      ? song.sections.flatMap((s) => s.lines.flatMap((l) => l.chords
        .filter((c) => c.chord_name === targetChordName)
        .map((c) => c.id)))
      : [chordId]

    const updatedChords = await Promise.all(
      allSameNameChordIds.map((cId) =>
        updateChordVoicing(id, cId, voicingIndex, voicingSignature, voicingChordName, true)
      )
    )
    const updatedById = new Map(allSameNameChordIds.map((cId, i) => [cId, updatedChords[i]]))

    invalidateVoicingPreferencesCache()
    setVoicingPreferenceVersion(recordVoicingPreference({
      previousChordName: primaryChord?.has_custom_voicing ? primaryChord.preferred_voicing_chord_name : null,
      previousSignature: primaryChord?.has_custom_voicing ? primaryChord.preferred_voicing_signature : null,
      chordName: voicingChordName,
      signature: voicingSignature,
    }))
    setSong((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((section) => ({
          ...section,
          lines: section.lines.map((line) => ({
            ...line,
            chords: line.chords.map((chord) => {
              const updated = updatedById.get(chord.id)
              return updated ? { ...chord, ...updated } : chord
            }),
          })),
        })),
      }
    })
    setPopover((prev) => prev && prev.chordId === chordId
      ? {
        ...prev,
        initialVoicingIndex: voicingIndex,
        initialVoicingSignature: voicingSignature ?? null,
        initialVoicingChordName: voicingChordName ?? null,
      }
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

    const keyOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const normKey = (k: string) => k.replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#').replace('m', '')
    const origIdx = keyOrder.indexOf(normKey(song.key))
    const newIdx = keyOrder.indexOf(normKey(displayKey))
    const semitones = origIdx === -1 || newIdx === -1 ? 0 : (newIdx - origIdx + 12) % 12
    const songLevelVoicingPreferences = buildSongLevelVoicingPreferenceMap(song)

    return song.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => ({
        ...line,
        chords: line.chords.map((chord) => {
          const effectiveChord = applyEffectiveVoicingPreference(
            chord,
            songLevelVoicingPreferences.get(chord.chord_name),
          )

          return {
            ...effectiveChord,
            chord_name: transposeChord(chord.chord_name, semitones),
          }
        }),
      })),
    }))
  }, [song, displayKey])

  async function handleEstimateKey() {
    setIsEstimatingKey(true)
    try {
      const estimated = await estimateKey(draftSections, draftCapo)
      if (estimated) setDraftOriginalKey(estimated)
    } catch {
      // ignore
    } finally {
      setIsEstimatingKey(false)
    }
  }

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
    setIsAutoScrolling(false)
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
        position: 'sticky',
        top: 0,
        zIndex: 20,
        backgroundColor: isEditing ? '#f5f5f5' : 'white',
        borderBottom: '1px solid #e5e7eb',
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
              <div style={{ display: 'flex', gap: '4px' }}>
                <select
                  value={draftOriginalKey}
                  onChange={(event) => setDraftOriginalKey(event.target.value)}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: 'white', minWidth: 0 }}
                >
                  {COMMON_KEYS.map((keyOption) => (
                    <option key={keyOption} value={keyOption}>原曲キー: {keyOption}</option>
                  ))}
                </select>
                <button
                  onClick={handleEstimateKey}
                  disabled={isEstimatingKey}
                  title="コードとカポからキーを推定"
                  style={{
                    padding: '8px 10px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    backgroundColor: 'white',
                    cursor: isEstimatingKey ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    color: '#555',
                  }}
                >
                  {isEstimatingKey ? '…' : '推定'}
                </button>
              </div>
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
                  {chromaticKeys.map(k => {
                    const isOriginal = !!song.original_key
                      && getKeyChroma(k) === getKeyChroma(song.original_key)
                      && k.endsWith('m') === song.original_key.endsWith('m')
                    return (
                      <option key={k} value={k}>
                        {k}{k === song.key ? '（譜面）' : ''}{isOriginal ? '（原曲）' : ''}
                      </option>
                    )
                  })}
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                <span style={{ fontSize: '12px', color: '#888', whiteSpace: 'nowrap' }}>速度 {scrollLevel}</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={scrollLevel}
                  onChange={e => setScrollLevel(Number(e.target.value))}
                  style={{ width: '80px', accentColor: 'var(--theme-color)', cursor: 'pointer' }}
                  title="スクロール速度"
                />
                <button
                  onClick={() => setIsAutoScrolling(v => !v)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: isAutoScrolling ? 'var(--theme-color)' : 'white',
                    color: isAutoScrolling ? 'var(--theme-color-contrast)' : '#555',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: isAutoScrolling ? 'bold' : 'normal',
                    touchAction: 'manipulation',
                  }}
                  title="自動スクロール"
                >
                  {isAutoScrolling ? '■ 停止' : '▶ 自動'}
                </button>
              </div>
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
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div
          onClick={() => setIsAutoScrolling(v => !v)}
          style={{ cursor: isAutoScrolling ? 'pointer' : 'pointer' }}
        >
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
              preferenceVersion={voicingPreferenceVersion}
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
          preferenceVersion={voicingPreferenceVersion}
          position={popover.position}
          onSaveVoicing={(voicingIndex, voicingSignature, chordName) => (
            handleSaveVoicing(popover.chordId, voicingIndex, voicingSignature, chordName)
          )}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
