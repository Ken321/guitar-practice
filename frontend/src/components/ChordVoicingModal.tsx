import { useEffect, useRef, useState } from 'react'
import { ChordPosition, resolveChordVoicingsAsync } from '../utils/chordVoicings'
import { StaticChordDiagram } from './ChordDiagram'

interface ChordVoicingModalProps {
  chordName: string
  displayName?: string
  initialVoicingIndex: number
  onClose: () => void
  onConfirm: (voicingIndex: number) => Promise<void>
}

export default function ChordVoicingModal({
  chordName,
  displayName,
  initialVoicingIndex,
  onClose,
  onConfirm,
}: ChordVoicingModalProps) {
  const [positions, setPositions] = useState<ChordPosition[]>([])
  const [selectedIndex, setSelectedIndex] = useState(initialVoicingIndex)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setPositions(nextPositions)
        setLoading(false)
      }
    }

    loadPositions().catch((err) => {
      console.error(err)
      if (!cancelled) {
        setPositions([])
        setError('候補の生成に失敗しました')
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [chordName, initialVoicingIndex])

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
      await onConfirm(selectedIndex)
      onClose()
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
          {positions.map((position, index) => {
            const selected = index === selectedIndex

            return (
              <button
                key={`${position.baseFret}-${position.frets.join('-')}-${index}`}
                onClick={() => setSelectedIndex(index)}
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
                  {`${index + 1}. [${toAbsoluteFrets(position).join(', ')}]`}
                </div>
              </button>
            )
          })}
          {!loading && positions.length === 0 && (
            <div style={{ color: '#6b7280', fontSize: '14px' }}>
              候補が見つかりませんでした
            </div>
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
              disabled={saving || loading || positions.length === 0}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: saving || loading || positions.length === 0 ? 'var(--theme-color-muted)' : 'var(--theme-color)',
                color: 'var(--theme-color-contrast)',
                fontWeight: 700,
                cursor: saving || loading || positions.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? '保存中...' : 'この押さえ方で保存'}
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
