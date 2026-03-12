import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SongListItem } from '../types'
import { getSongs, deleteSong } from '../api/client'

export default function SongList() {
  const navigate = useNavigate()
  const [songs, setSongs] = useState<SongListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([])
  const [deletingSongIds, setDeletingSongIds] = useState<string[]>([])

  useEffect(() => {
    loadSongs()
  }, [])

  async function loadSongs() {
    try {
      setLoading(true)
      const data = await getSongs()
      setSongs(data)
    } catch (err) {
      setError('曲リストの読み込みに失敗しました')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleBulkDelete() {
    if (selectedSongIds.length === 0) return

    const idsToDelete = selectedSongIds.filter(id => songs.some(song => song.id === id))
    if (idsToDelete.length === 0) return

    const message = idsToDelete.length === 1
      ? `選択した1件を削除しますか？`
      : `選択した${idsToDelete.length}件を削除しますか？`

    if (!window.confirm(message)) return

    setDeletingSongIds(idsToDelete)
    try {
      const results = await Promise.allSettled(idsToDelete.map(id => deleteSong(id)))
      const succeededIds = idsToDelete.filter((_, idx) => results[idx].status === 'fulfilled')
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')

      if (succeededIds.length > 0) {
        setSongs(prev => prev.filter(song => !succeededIds.includes(song.id)))
        setSelectedSongIds(prev => prev.filter(id => !succeededIds.includes(id)))
      }

      if (failedResults.length > 0) {
        failedResults.forEach(result => console.error(result.reason))
        alert(
          failedResults.length === idsToDelete.length
            ? '削除に失敗しました'
            : `${succeededIds.length}件を削除しました。${failedResults.length}件は削除に失敗しました`
        )
      }
    } catch (err) {
      alert('削除に失敗しました')
      console.error(err)
    } finally {
      setDeletingSongIds([])
    }
  }

  function handleToggleSelect(songId: string, checked: boolean) {
    setSelectedSongIds(prev => {
      if (checked) {
        return prev.includes(songId) ? prev : [...prev, songId]
      }

      return prev.filter(id => id !== songId)
    })
  }

  const filteredSongs = songs.filter(song => {
    const q = searchQuery.toLowerCase()
    return (
      song.title.toLowerCase().includes(q) ||
      song.artist.toLowerCase().includes(q)
    )
  })
  const selectedCount = selectedSongIds.length
  const isDeleting = deletingSongIds.length > 0

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#2c3e50' }}>
          曲リスト
          {!loading && (
            <span style={{ fontSize: '14px', fontWeight: 'normal', color: '#999', marginLeft: '8px' }}>
              ({filteredSongs.length}曲)
            </span>
          )}
        </h1>
        <button
          onClick={() => navigate('/add')}
          style={{
            padding: '10px 20px',
            backgroundColor: 'var(--theme-color)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          + 新規作成
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="曲名・アーティスト名で検索..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            border: '1px solid #ddd',
            borderRadius: '8px',
            fontSize: '14px',
            backgroundColor: 'white',
            outline: 'none',
          }}
        />
      </div>

      {/* Content */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '8px', marginBottom: '16px' }}>
          {error}
          <button onClick={loadSongs} style={{ marginLeft: '12px', color: '#dc2626', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>
            再試行
          </button>
        </div>
      )}

      {!loading && !error && filteredSongs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
          {searchQuery ? '検索結果が見つかりませんでした' : '曲が登録されていません。新規作成から追加してください。'}
        </div>
      )}

      {!loading && filteredSongs.length > 0 && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          overflow: 'hidden',
        }}>
          {selectedCount > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              backgroundColor: '#fcfbf7',
            }}>
              <span style={{ fontSize: '13px', color: '#666' }}>
                {selectedCount}件選択中
              </span>
              <button
                onClick={handleBulkDelete}
                disabled={isDeleting}
                style={{
                  padding: '8px 14px',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  border: '1px solid #fca5a5',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  opacity: isDeleting ? 0.6 : 1,
                }}
              >
                一括削除
              </button>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e8e8e8' }}>
                <th style={{ padding: '12px 12px 12px 16px', textAlign: 'center', width: '56px' }} />
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', color: '#666', fontWeight: '600' }}>曲名</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', color: '#666', fontWeight: '600' }}>アーティスト</th>
              </tr>
            </thead>
            <tbody>
              {filteredSongs.map((song, idx) => {
                const isSelected = selectedSongIds.includes(song.id)

                return (
                  <tr
                    key={song.id}
                    onClick={() => navigate(`/songs/${song.id}`)}
                    style={{
                      borderBottom: idx < filteredSongs.length - 1 ? '1px solid #f0f0f0' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s',
                      backgroundColor: isSelected ? 'var(--theme-color-soft)' : 'white',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = isSelected ? 'var(--theme-color-soft-strong)' : '#f8f9fa'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = isSelected ? 'var(--theme-color-soft)' : 'white'
                    }}
                  >
                    <td
                      style={{ padding: '14px 12px 14px 16px', textAlign: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isDeleting}
                        onChange={(e) => handleToggleSelect(song.id, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${song.title} を選択`}
                      />
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: '500', color: '#2c3e50' }}>
                      {song.title}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#555' }}>
                      {song.artist}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
