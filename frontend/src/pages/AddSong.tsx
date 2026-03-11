import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScrapeResponse, SectionCreate } from '../types'
import { scrapeSong, createSong, updateSongContent } from '../api/client'
import { COMMON_KEYS, transposeKeyName } from '../utils/degree'
import SongEditor from '../components/SongEditor'

type Step = 'form' | 'loading' | 'preview' | 'manual'
type SearchMode = 'search' | 'url'

const SEARCH_PROGRESS_MESSAGES = [
  '検索条件を整理しています',
  'U-フレットを検索しています',
  '楽器.me も確認しています',
  '取得したコードデータを整形しています',
]

const URL_PROGRESS_MESSAGES = [
  'URLを確認しています',
  '楽曲ページを開いています',
  'コードと歌詞を抽出しています',
  'プレビュー用のデータを整形しています',
]

export default function AddSong() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('form')
  const [searchMode, setSearchMode] = useState<SearchMode>('search')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [originalKey, setOriginalKey] = useState('C')
  const [capo, setCapo] = useState(0)
  const [scrapeResult, setScrapeResult] = useState<ScrapeResponse | null>(null)
  const [editableScrapedSections, setEditableScrapedSections] = useState<SectionCreate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [manualText, setManualText] = useState('')
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)

  useEffect(() => {
    if (step !== 'loading') {
      setLoadingProgress(0)
      setLoadingMessageIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 92) return prev
        const increment = prev < 25 ? 10 : prev < 55 ? 7 : prev < 80 ? 4 : 2
        return Math.min(92, prev + increment)
      })
      setLoadingMessageIndex((prev) => {
        const messages = searchMode === 'search' ? SEARCH_PROGRESS_MESSAGES : URL_PROGRESS_MESSAGES
        return Math.min(prev + 1, messages.length - 1)
      })
    }, 900)

    return () => window.clearInterval(intervalId)
  }, [step, searchMode])

  const chartKey = useMemo(() => transposeKeyName(originalKey, -capo), [originalKey, capo])

  async function handleScrape() {
    if (searchMode === 'search' && (!title.trim() || !artist.trim())) {
      setError('曲名とアーティスト名を入力してください')
      return
    }
    if (searchMode === 'url' && !sourceUrl.trim()) {
      setError('URLを入力してください')
      return
    }
    setError(null)
    setStep('loading')

    try {
      const result = searchMode === 'search'
        ? await scrapeSong({ title: title.trim(), artist: artist.trim() })
        : await scrapeSong({ url: sourceUrl.trim() })
      setScrapeResult(result)
      setEditableScrapedSections(result.sections)
      setCapo(result.detected_capo ?? 0)
      if (result.detected_original_key) {
        setOriginalKey(result.detected_original_key)
      } else if (result.detected_key) {
        setOriginalKey(transposeKeyName(result.detected_key, result.detected_capo ?? 0))
      }
      if (result.detected_title) setTitle(result.detected_title)
      if (result.detected_artist) setArtist(result.detected_artist)
      setLoadingProgress(100)
      setStep('preview')
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '楽曲データの取得に失敗しました。手動入力に切り替えます。'
      setError(msg)
      setStep('manual')
    }
  }

  async function handleSaveScraped() {
    if (!scrapeResult) return
    if (!title.trim() || !artist.trim()) {
      setError('保存前に曲名とアーティスト名を入力してください')
      return
    }
    setSaving(true)
    try {
      const song = await createSong({
        title: title.trim(),
        artist: artist.trim(),
        key: chartKey,
        original_key: originalKey,
        capo,
        source_url: scrapeResult.source_url,
      })
      await updateSongContent(song.id, editableScrapedSections)
      navigate(`/songs/${song.id}`)
    } catch (err) {
      setError('保存に失敗しました')
      console.error(err)
      setSaving(false)
    }
  }

  function parseManualText(text: string): SectionCreate[] {
    const lines = text.split('\n')
    const sections: SectionCreate[] = []
    let currentSection: SectionCreate = { order: 0, label: 'Verse', lines: [] }
    const sectionPattern = /^[\[【](.*?)[\]】]$/

    let lineOrder = 0
    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (!trimmed) continue

      const sectionMatch = trimmed.match(sectionPattern)
      if (sectionMatch) {
        if (currentSection.lines.length > 0) sections.push(currentSection)
        currentSection = { order: sections.length, label: sectionMatch[1], lines: [] }
        lineOrder = 0
        continue
      }

      currentSection.lines.push({ order: lineOrder++, lyrics: trimmed, chords: [] })
    }

    if (currentSection.lines.length > 0) sections.push(currentSection)
    return sections
  }

  async function handleSaveManual() {
    if (!title.trim() || !artist.trim()) {
      setError('曲名とアーティスト名を入力してください')
      return
    }
    setSaving(true)
    try {
      const sections = parseManualText(manualText)
      const song = await createSong({
        title: title.trim(),
        artist: artist.trim(),
        key: chartKey,
        original_key: originalKey,
        capo,
        source_url: sourceUrl.trim() || undefined,
      })
      if (sections.length > 0) {
        await updateSongContent(song.id, sections)
      }
      navigate(`/songs/${song.id}`)
    } catch (err) {
      setError('保存に失敗しました')
      console.error(err)
      setSaving(false)
    }
  }

  // Count sections and lines in scrape result
  function getScrapeStats() {
    if (!editableScrapedSections.length) return { sections: 0, lines: 0, chords: 0 }
    const sections = editableScrapedSections.length
    const lines = editableScrapedSections.reduce((acc, s) => acc + s.lines.length, 0)
    const chords = editableScrapedSections.reduce((acc, s) =>
      acc + s.lines.reduce((a, l) => a + l.chords.length, 0), 0
    )
    return { sections, lines, chords }
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/')}
          style={{ padding: '6px 12px', backgroundColor: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
        >
          ← 戻る
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#2c3e50' }}>新規曲を追加</h1>
      </div>

      {/* Search Form */}
      {(step === 'form' || step === 'loading') && (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>
          <p style={{ color: '#555', marginBottom: '20px', fontSize: '14px' }}>
            曲名とアーティスト名で検索するか、対応サイトのURLから直接コードデータを取得できます。
          </p>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={() => { setSearchMode('search'); setError(null) }}
              disabled={step === 'loading'}
              style={{
                padding: '10px 14px',
                backgroundColor: searchMode === 'search' ? 'var(--theme-color)' : 'white',
                color: searchMode === 'search' ? 'white' : '#555',
                border: `1px solid ${searchMode === 'search' ? 'var(--theme-color)' : '#ddd'}`,
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: step === 'loading' ? 'not-allowed' : 'pointer',
              }}
            >
              曲名・アーティストで検索
            </button>
            <button
              onClick={() => { setSearchMode('url'); setError(null) }}
              disabled={step === 'loading'}
              style={{
                padding: '10px 14px',
                backgroundColor: searchMode === 'url' ? 'var(--theme-color)' : 'white',
                color: searchMode === 'url' ? 'white' : '#555',
                border: `1px solid ${searchMode === 'url' ? 'var(--theme-color)' : '#ddd'}`,
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: step === 'loading' ? 'not-allowed' : 'pointer',
              }}
            >
              URLから追加
            </button>
          </div>

          {searchMode === 'search' ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '6px', fontWeight: '500' }}>
                  曲名 <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="例: 夜に駆ける"
                  disabled={step === 'loading'}
                  onKeyDown={e => { if (e.key === 'Enter') handleScrape() }}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '6px', fontWeight: '500' }}>
                  アーティスト名 <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  value={artist}
                  onChange={e => setArtist(e.target.value)}
                  placeholder="例: YOASOBI"
                  disabled={step === 'loading'}
                  onKeyDown={e => { if (e.key === 'Enter') handleScrape() }}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '6px', fontWeight: '500' }}>
                楽曲URL <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                value={sourceUrl}
                onChange={e => setSourceUrl(e.target.value)}
                placeholder="例: https://www.ufret.jp/song.php?data=..."
                disabled={step === 'loading'}
                onKeyDown={e => { if (e.key === 'Enter') handleScrape() }}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
              />
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#999' }}>
                対応サイト: U-フレット、楽器.me
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: '10px 12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleScrape}
              disabled={
                step === 'loading' ||
                (searchMode === 'search' ? (!title.trim() || !artist.trim()) : !sourceUrl.trim())
              }
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: step === 'loading' ? 'var(--theme-color-muted)' : 'var(--theme-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: step === 'loading' ? 'not-allowed' : 'pointer',
              }}
            >
              {step === 'loading' ? '検索中...' : '検索・取得'}
            </button>
            <button
              onClick={() => setStep('manual')}
              disabled={step === 'loading'}
              style={{
                padding: '12px 16px',
                backgroundColor: 'white',
                color: '#555',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              手動入力
            </button>
          </div>

          {step === 'loading' && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', color: '#666', fontSize: '13px' }}>
                <span>コードデータを取得しています...</span>
                <span>{loadingProgress}%</span>
              </div>
              <div style={{ height: '8px', backgroundColor: '#e5e7eb', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
                <div
                  style={{
                    width: `${loadingProgress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--theme-color), #60a5fa)',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '11px', color: '#999' }}>
                {(searchMode === 'search' ? SEARCH_PROGRESS_MESSAGES : URL_PROGRESS_MESSAGES)[loadingMessageIndex]}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview scraped result */}
      {step === 'preview' && scrapeResult && (
        <div>
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
          }}>
            <div style={{ fontWeight: 'bold', color: '#16a34a', marginBottom: '8px' }}>
              コードデータを取得しました
            </div>
            {(() => {
              const stats = getScrapeStats()
              return (
                <div style={{ fontSize: '13px', color: '#555', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span>{stats.sections} セクション</span>
                  <span>{stats.lines} 行</span>
                  <span>{stats.chords} コード</span>
                  <span>原曲キー: <strong>{originalKey}</strong></span>
                  <span>譜面キー: <strong>{chartKey}</strong></span>
                  <span>カポ: <strong>{capo}</strong></span>
                </div>
              )
            })()}
            {scrapeResult.source_url && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
                ソース: <a href={scrapeResult.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--theme-color)' }}>{scrapeResult.source_url}</a>
              </div>
            )}
          </div>

          {/* Meta */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '20px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '16px', color: '#333' }}>曲情報</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 120px 120px', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>曲名</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>アーティスト</label>
                <input
                  value={artist}
                  onChange={e => setArtist(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>原曲キー</label>
                <select
                  value={originalKey}
                  onChange={e => setOriginalKey(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                >
                  {COMMON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>譜面キー</label>
                <input
                  value={chartKey}
                  readOnly
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', backgroundColor: '#f9fafb', color: '#555' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>カポ</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={capo}
                  onChange={e => setCapo(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                />
              </div>
            </div>
          </div>

          {/* Content Preview */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '20px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>コードシート編集</h3>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
              閲覧画面の編集モードと同じ仕様です。行やコードを必要に応じて調整してから保存してください。
            </div>
            <SongEditor
              sections={editableScrapedSections}
              onChange={setEditableScrapedSections}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setStep('form'); setScrapeResult(null); setEditableScrapedSections([]); setError(null) }}
              style={{ padding: '10px 16px', backgroundColor: 'white', color: '#555', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            >
              やり直す
            </button>
            <button
              onClick={handleSaveScraped}
              disabled={saving || !title.trim() || !artist.trim()}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: saving || !title.trim() || !artist.trim() ? 'var(--theme-color-muted)' : 'var(--theme-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: saving || !title.trim() || !artist.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* Manual input */}
      {step === 'manual' && (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px', color: '#333' }}>手動入力</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 120px 120px', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>曲名 *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="例: 夜に駆ける"
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>アーティスト *</label>
              <input
                value={artist}
                onChange={e => setArtist(e.target.value)}
                placeholder="例: YOASOBI"
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>原曲キー</label>
              <select
                value={originalKey}
                onChange={e => setOriginalKey(e.target.value)}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              >
                {COMMON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>譜面キー</label>
              <input
                value={chartKey}
                readOnly
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', backgroundColor: '#f9fafb', color: '#555' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>カポ</label>
              <input
                type="number"
                min={0}
                max={12}
                value={capo}
                onChange={e => setCapo(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
              コードシートテキスト（オプション）
            </label>
            <div style={{ fontSize: '11px', color: '#999', marginBottom: '6px' }}>
              セクションは【イントロ】や[Aメロ]のように記述。コードは後で編集モードで追加できます。
            </div>
            <textarea
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              placeholder={`【イントロ】\nここに歌詞を入力\n\n【Aメロ】\n次の行の歌詞`}
              rows={12}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setStep('form'); setError(null) }}
              style={{ padding: '10px 16px', backgroundColor: 'white', color: '#555', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            >
              戻る
            </button>
            <button
              onClick={handleSaveManual}
              disabled={saving || !title.trim() || !artist.trim()}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: saving || !title.trim() || !artist.trim() ? 'var(--theme-color-muted)' : 'var(--theme-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: saving || !title.trim() || !artist.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
