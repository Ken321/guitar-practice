import { useEffect, useRef, useState, useMemo } from 'react'
import { ChordPosition, getChordPositionSignature, resolveChordVoicingsAsync, isValidCustomFretSignature, parseCustomFretSignature, CustomChordPosition } from '../utils/chordVoicings'
import { StaticChordDiagram } from './ChordDiagram'

interface ChordVoicingModalProps {
  chordName: string
  displayName?: string
  initialVoicingIndex: number
  savedVoicingIndex: number
  preferenceVersion?: number
  onClose: () => void
  onConfirm: (voicingIndex: number, voicingSignature?: string | null) => Promise<void>
}

export default function ChordVoicingModal({
  chordName,
  displayName,
  initialVoicingIndex,
  savedVoicingIndex,
  preferenceVersion = 0,
  onClose,
  onConfirm,
}: ChordVoicingModalProps) {
  const [basePositions, setBasePositions] = useState<ChordPosition[]>([])
  const [selectedIndex, setSelectedIndex] = useState(initialVoicingIndex)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [customInput, setCustomInput] = useState('')
  const customPosition = useMemo(() => parseCustomFretSignature(customInput), [customInput])

  const positions = useMemo(() => {
    let filtered = basePositions

    // If the user has typed something that isn't just empty space, use it as a filter
    const searchString = customInput.trim().toLowerCase()
    if (searchString) {
      filtered = basePositions.filter(p => {
        const sig = getChordPositionSignature(p)
        return sig.toLowerCase().includes(searchString)
      })
    }

    // If we have a valid complete custom position (e.g. from 1,2,3,4,5,6 input)
    // and it doesn't already exactly exist in the filtered list, we append it.
    if (customPosition) {
      const exists = filtered.some(p => getChordPositionSignature(p) === customPosition.signature)
      if (!exists) {
        return [customPosition as ChordPosition, ...filtered]
      }
    }
    return filtered
  }, [basePositions, customInput, customPosition])

  // Figure out the "no matches" state: 
  // Custom input is provided (and not a valid full signature), but nothing matches.
  const isSearchNoMatch = customInput.trim() !== '' && !customPosition && positions.length === 0

  const isSavedVoicingSelected = selectedIndex === savedVoicingIndex && (!customPosition || positions[0] !== customPosition)

  useEffect(() => {
    let cancelled = false

    setSelectedIndex(initialVoicingIndex)
    setError(null)

    async function loadPositions() {
      setLoading(true)
      const nextPositions = await resolveChordVoicingsAsync(chordName, {
        maxResults: 1000,
        maxFret: 18,
        maxSpan: 5,
        yieldEveryWindows: 1,
      })
      if (!cancelled) {
        setBasePositions(nextPositions)
        setLoading(false)
      }
    }

    loadPositions().catch((err) => {
      console.error(err)
      if (!cancelled) {
        setBasePositions([])
        setError('候補の生成に失敗しました')
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [chordName, initialVoicingIndex, preferenceVersion])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleConfirm() {
    try {
      setSaving(true)
      setError(null)

      let signatureToSave: string | null = null
      let finalIndex = selectedIndex

      if (selectedIndex === -1 && customPosition) {
        signatureToSave = customPosition.signature
        // We pass -1 to signal it's a purely custom/unranked position, 
        // the backend/frontend logic will use the signature to derive it later.
      } else {
        const position = basePositions[selectedIndex]
        signatureToSave = position ? getChordPositionSignature(position) : null
      }

      await onConfirm(finalIndex, signatureToSave)
    } catch (err) {
      console.error(err)
      setError('押さえ方の保存に失敗しました')
      setSaving(false)
    }
  }

  function toAbsoluteFrets(position: ChordPosition): number[] {
    return position.frets.map((fret) => {
      if (fret <= 0) return fret
      if (position.baseFret <= 1) return fret
      return position.baseFret + fret - 1
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(1100px, 100%)',
          maxHeight: 'min(88vh, 100%)',
          backgroundColor: 'white',
          borderRadius: '16px',
          boxShadow: '0 18px 60px rgba(15, 23, 42, 0.32)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '24px', color: '#111827' }}>{displayName ?? chordName}</h2>
            <div style={{ marginTop: '6px', fontSize: '13px', color: '#6b7280' }}>
              可能な限り候補を並べています。スクロールしながら選択して保存できます。
            </div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
              {loading ? '候補を生成中...' : `${positions.length} 件の候補`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              backgroundColor: '#f3f4f6',
              color: '#4b5563',
              width: '36px',
              height: '36px',
              borderRadius: '999px',
              fontSize: '20px',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#f8fafc',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>
              独自の押さえ方を入力 (例: -,-,1,2,1,2 または 1,3,3,2,1,1)
            </span>
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="-,-,1,2,1,2"
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '15px',
                outline: 'none',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
            />
          </label>
          {customInput && !customPosition && (
            <div style={{ marginTop: '6px', fontSize: '13px', color: '#dc2626' }}>
              無効な形式です。「-,-,1,2,1,2」のように6弦分のフレットをカンマ区切りで入力してください
            </div>
          )}
        </div>

        <div
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: '16px',
            alignContent: 'start',
            background:
              'linear-gradient(180deg, rgba(248,250,252,0.92) 0%, rgba(255,255,255,1) 28%)',
          }}
        >
          {loading && (
            <div style={{ gridColumn: '1 / -1', color: '#6b7280', fontSize: '14px' }}>
              候補を順番に生成しています...
            </div>
          )}
          {isSearchNoMatch ? (
            <div style={{
              gridColumn: '1 / -1',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 0',
              gap: '16px',
            }}>
              <div style={{ color: '#4b5563', fontSize: '15px' }}>
                「{customInput}」に一致する既存の候補はありません。
              </div>
              <div style={{ color: '#6b7280', fontSize: '13px' }}>
                独自の押さえ方を作成する場合は、6弦分のフレット位置をカンマ区切りで最後まで入力してください。
              </div>
              <div style={{
                marginTop: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px'
              }}>
                {customPosition && (
                  <div style={{ transform: 'scale(1.1)', transformOrigin: 'top center' }}>
                    <LazyStaticChordDiagram
                      chordName={chordName}
                      displayName="新規作成 (独自入力)"
                      position={customPosition}
                    />
                  </div>
                )}
                <button
                  onClick={() => {
                    setSelectedIndex(-1)
                    setTimeout(() => handleConfirm(), 0)
                  }}
                  disabled={saving}
                  style={{
                    width: '160px',
                    height: '200px',
                    borderRadius: '12px',
                    background: 'none',
                    border: '2px dashed #cbd5e1',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                    fontSize: '14px',
                    fontWeight: 600,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = 'var(--theme-color)'
                    e.currentTarget.style.color = 'var(--theme-color)'
                    e.currentTarget.style.backgroundColor = 'var(--theme-color-soft)'
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#cbd5e1'
                    e.currentTarget.style.color = '#64748b'
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  {saving ? '保存中...' : '新規作成'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {positions.map((position, displayIndex) => {
                const isCustomDisplay = (position as any).isCustom

                // Re-align the index to match the actual element in basePositions
                let positionIndex = displayIndex
                if (positions.some(p => (p as any).isCustom)) {
                  positionIndex = displayIndex - 1
                }

                const selected = isCustomDisplay ? selectedIndex === -1 : positionIndex === selectedIndex

                return (
                  <button
                    key={`${position.baseFret}-${position.frets.join('-')}-${displayIndex}`}
                    onClick={() => setSelectedIndex(isCustomDisplay ? -1 : positionIndex)}
                    style={{
                      border: selected ? '2px solid var(--theme-color)' : '1px solid #d1d5db',
                      backgroundColor: selected ? 'var(--theme-color-soft)' : 'white',
                      borderRadius: '14px',
                      padding: '14px 10px 12px',
                      cursor: 'pointer',
                      boxShadow: selected ? '0 8px 24px rgba(22, 22, 14, 0.14)' : 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <LazyStaticChordDiagram
                      chordName={chordName}
                      displayName={displayName}
                      position={position}
                    />
                    <div style={{ fontSize: '12px', color: '#4b5563', lineHeight: 1.5 }}>
                      {isCustomDisplay ? '新規作成 (独自入力)' : `${positionIndex + 1}. [${getChordPositionSignature(position)}]`}
                    </div>
                  </button>
                )
              })}
              {!loading && positions.length === 0 && !customInput && (
                <div style={{ color: '#6b7280', fontSize: '14px' }}>
                  候補が見つかりませんでした
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '13px', color: error ? '#dc2626' : '#6b7280' }}>
            {error ?? `選択中: ${selectedIndex + 1} / ${Math.max(positions.length, 1)}`}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                color: '#4b5563',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              閉じる
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || loading || positions.length === 0 || isSavedVoicingSelected}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: saving || loading || positions.length === 0 || isSavedVoicingSelected ? 'var(--theme-color-muted)' : 'var(--theme-color)',
                color: 'var(--theme-color-contrast)',
                fontWeight: 700,
                cursor: saving || loading || positions.length === 0 || isSavedVoicingSelected ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? '保存中...' : isSavedVoicingSelected ? 'この押さえ方は保存済み' : 'この押さえ方で保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LazyStaticChordDiagram({
  chordName,
  displayName,
  position,
}: {
  chordName: string
  displayName?: string
  position: ChordPosition
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '240px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '160px',
        height: '200px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {visible ? (
        <StaticChordDiagram
          chordName={chordName}
          displayName={displayName}
          position={position}
        />
      ) : (
        <div
          style={{
            width: '160px',
            height: '200px',
            borderRadius: '12px',
            background:
              'linear-gradient(135deg, rgba(241,245,249,1) 0%, rgba(226,232,240,0.72) 100%)',
          }}
        />
      )}
    </div>
  )
}
