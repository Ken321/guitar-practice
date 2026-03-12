import { useEffect, useRef, useState } from 'react'
import ChordDiagram from './ChordDiagram'
import ChordVoicingModal from './ChordVoicingModal'
import { getChordPositionSignature, resolveChordVoicings } from '../utils/chordVoicings'

interface ChordPopoverProps {
  chordName: string
  displayName?: string
  initialVoicingIndex?: number
  preferenceVersion?: number
  position: { x: number; y: number }
  onSaveVoicing?: (voicingIndex: number, voicingSignature?: string | null, chordName?: string | null) => Promise<void>
  onClose: () => void
}

export default function ChordPopover({
  chordName,
  displayName,
  initialVoicingIndex = 0,
  preferenceVersion = 0,
  position,
  onSaveVoicing,
  onClose,
}: ChordPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [voicingIndex, setVoicingIndex] = useState(initialVoicingIndex)
  const [showVoicingModal, setShowVoicingModal] = useState(false)
  const [modalInitialVoicingIndex, setModalInitialVoicingIndex] = useState(initialVoicingIndex)
  const [saveError, setSaveError] = useState<string | null>(null)
  const isSavedVoicingSelected = voicingIndex === initialVoicingIndex

  useEffect(() => {
    setVoicingIndex(initialVoicingIndex)
    setModalInitialVoicingIndex(initialVoicingIndex)
    setSaveError(null)
  }, [chordName, initialVoicingIndex])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Calculate position to stay within viewport
  const popoverWidth = 260
  const popoverHeight = 360
  const margin = 8

  let left = position.x
  let top = position.y + 8

  if (left + popoverWidth > window.innerWidth - margin) {
    left = window.innerWidth - popoverWidth - margin
  }
  if (left < margin) left = margin

  if (top + popoverHeight > window.innerHeight - margin) {
    top = position.y - popoverHeight - 8
  }
  if (top < margin) top = margin

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 1000,
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        border: '1px solid #e0e0e0',
        padding: '16px',
        minWidth: `${popoverWidth}px`,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
      }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>{displayName ?? chordName}</h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            color: '#999',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '2px 6px',
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <ChordDiagram
        chordName={chordName}
        displayName={displayName}
        voicingIndex={voicingIndex}
        preferenceVersion={preferenceVersion}
        onVoicingChange={setVoicingIndex}
        onExploreMore={() => {
          setModalInitialVoicingIndex(voicingIndex)
          setShowVoicingModal(true)
        }}
      />
      {saveError && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#dc2626' }}>
          {saveError}
        </div>
      )}
      {onSaveVoicing && (
        <button
          onClick={async () => {
            try {
              setSaveError(null)
              const positions = resolveChordVoicings(chordName, { maxResults: voicingIndex + 1, maxFret: 18, maxSpan: 5 })
              const position = positions[voicingIndex]
              await onSaveVoicing(voicingIndex, position ? getChordPositionSignature(position) : null, chordName)
            } catch (err) {
              console.error(err)
              setSaveError('押さえ方の保存に失敗しました')
            }
          }}
          disabled={isSavedVoicingSelected}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: isSavedVoicingSelected ? 'var(--theme-color-muted)' : 'var(--theme-color)',
            color: 'var(--theme-color-contrast)',
            fontWeight: 700,
            cursor: isSavedVoicingSelected ? 'not-allowed' : 'pointer',
            opacity: isSavedVoicingSelected ? 0.75 : 1,
          }}
        >
          {isSavedVoicingSelected ? 'この押さえ方は保存済み' : 'この押さえ方を保存'}
        </button>
      )}
      {showVoicingModal && onSaveVoicing && (
        <ChordVoicingModal
          chordName={chordName}
          displayName={displayName}
          initialVoicingIndex={modalInitialVoicingIndex}
          savedVoicingIndex={initialVoicingIndex}
          preferenceVersion={preferenceVersion}
          onClose={() => setShowVoicingModal(false)}
          onConfirm={async (nextIndex, voicingSignature) => {
            await onSaveVoicing(nextIndex, voicingSignature, chordName)
            setVoicingIndex(nextIndex)
          }}
        />
      )}
    </div>
  )
}
