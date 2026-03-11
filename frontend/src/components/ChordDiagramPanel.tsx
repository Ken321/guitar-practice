import { useState } from 'react'
import ChordDiagram from './ChordDiagram'

interface ChordDiagramPanelProps {
  chordNames: string[]
}

export default function ChordDiagramPanel({ chordNames }: ChordDiagramPanelProps) {
  const [voicingIndices, setVoicingIndices] = useState<Record<string, number>>({})

  if (chordNames.length === 0) return null

  function getVoicingIndex(chordName: string): number {
    return voicingIndices[chordName] ?? 0
  }

  function setVoicingIndex(chordName: string, index: number) {
    setVoicingIndices(prev => ({ ...prev, [chordName]: index }))
  }

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      padding: '16px',
      marginBottom: '16px',
    }}>
      <div style={{
        fontSize: '13px',
        fontWeight: 'bold',
        color: '#666',
        marginBottom: '12px',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}>
        使用コード一覧
      </div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
      }}>
        {chordNames.map(chordName => (
          <div
            key={chordName}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '8px 4px',
              backgroundColor: '#fafafa',
              minWidth: '108px',
            }}
          >
            <ChordDiagram
              chordName={chordName}
              voicingIndex={getVoicingIndex(chordName)}
              onVoicingChange={(idx) => setVoicingIndex(chordName, idx)}
              compact={true}
            />
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '4px',
            }}>
              <button
                onClick={() => setVoicingIndex(chordName, Math.max(0, getVoicingIndex(chordName) - 1))}
                style={{
                  padding: '2px 6px',
                  border: '1px solid #ccc',
                  borderRadius: '3px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  fontSize: '12px',
                  lineHeight: 1,
                }}
                title="前のボイシング"
              >
                ‹
              </button>
              <span style={{ fontSize: '10px', color: '#999', minWidth: '16px', textAlign: 'center' }}>
                {getVoicingIndex(chordName) + 1}
              </span>
              <button
                onClick={() => setVoicingIndex(chordName, getVoicingIndex(chordName) + 1)}
                style={{
                  padding: '2px 6px',
                  border: '1px solid #ccc',
                  borderRadius: '3px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  fontSize: '12px',
                  lineHeight: 1,
                }}
                title="次のボイシング"
              >
                ›
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
