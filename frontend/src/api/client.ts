import axios from 'axios'
import type {
  Song,
  SongCreate,
  SongUpdate,
  SectionCreate,
  ScrapeRequest,
  ScrapeResponse,
  ChordPlacement,
  SongListItem,
  VoicingPreference,
} from '../types'

const api = axios.create({
  // Use VITE_API_URL if provided (e.g., in production), otherwise use empty string
  // to rely on Vite's proxy during local development, avoiding CORS issues.
  baseURL: import.meta.env.VITE_API_URL ?? '',
  headers: {
    'Content-Type': 'application/json',
  },
})

const CACHE_TTL = 60_000 // 60秒

let songListCache: { data: SongListItem[]; timestamp: number } | null = null
const songDetailCache = new Map<string, { data: Song; timestamp: number }>()
let voicingPreferencesCache: { data: VoicingPreference[]; timestamp: number } | null = null

function invalidateSongListCache() {
  songListCache = null
}

function invalidateSongDetailCache(id: string) {
  songDetailCache.delete(id)
}

export async function getSongs(): Promise<SongListItem[]> {
  if (songListCache && Date.now() - songListCache.timestamp < CACHE_TTL) {
    return songListCache.data
  }
  const response = await api.get<SongListItem[]>('/api/songs')
  songListCache = { data: response.data, timestamp: Date.now() }
  return response.data
}

export async function getSong(id: string): Promise<Song> {
  const cached = songDetailCache.get(id)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  const response = await api.get<Song>(`/api/songs/${id}`)
  songDetailCache.set(id, { data: response.data, timestamp: Date.now() })
  return response.data
}

export async function createSong(data: SongCreate): Promise<Song> {
  const response = await api.post<Song>('/api/songs', data)
  invalidateSongListCache()
  return response.data
}

export async function updateSong(id: string, data: SongUpdate): Promise<Song> {
  const response = await api.put<Song>(`/api/songs/${id}`, data)
  invalidateSongListCache()
  invalidateSongDetailCache(id)
  return response.data
}

export async function deleteSong(id: string): Promise<void> {
  await api.delete(`/api/songs/${id}`)
  invalidateSongListCache()
  invalidateSongDetailCache(id)
}

export async function updateSongContent(id: string, sections: SectionCreate[]): Promise<Song> {
  const response = await api.put<Song>(`/api/songs/${id}/content`, { sections })
  invalidateSongDetailCache(id)
  return response.data
}

export async function scrapeSong(data: ScrapeRequest): Promise<ScrapeResponse> {
  const response = await api.post<ScrapeResponse>('/api/scrape', data)
  return response.data
}

export async function getVoicingPreferences(): Promise<VoicingPreference[]> {
  if (voicingPreferencesCache && Date.now() - voicingPreferencesCache.timestamp < CACHE_TTL) {
    return voicingPreferencesCache.data
  }
  const response = await api.get<VoicingPreference[]>('/api/songs/voicing-preferences')
  voicingPreferencesCache = { data: response.data, timestamp: Date.now() }
  return response.data
}

export function invalidateVoicingPreferencesCache() {
  voicingPreferencesCache = null
}

export async function updateChordVoicing(
  songId: string,
  chordId: string,
  preferredVoicing: number,
  preferredVoicingSignature?: string | null,
  preferredVoicingChordName?: string | null,
  hasCustomVoicing = true,
): Promise<ChordPlacement> {
  const response = await api.patch<ChordPlacement>(`/api/songs/${songId}/chords/${chordId}`, {
    preferred_voicing: preferredVoicing,
    has_custom_voicing: hasCustomVoicing,
    preferred_voicing_signature: preferredVoicingSignature ?? null,
    preferred_voicing_chord_name: preferredVoicingChordName ?? null,
  })
  invalidateSongDetailCache(songId)
  return response.data
}

export default api
