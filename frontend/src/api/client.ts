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
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
})

export async function getSongs(): Promise<SongListItem[]> {
  const response = await api.get<SongListItem[]>('/api/songs')
  return response.data
}

export async function getSong(id: string): Promise<Song> {
  const response = await api.get<Song>(`/api/songs/${id}`)
  return response.data
}

export async function createSong(data: SongCreate): Promise<Song> {
  const response = await api.post<Song>('/api/songs', data)
  return response.data
}

export async function updateSong(id: string, data: SongUpdate): Promise<Song> {
  const response = await api.put<Song>(`/api/songs/${id}`, data)
  return response.data
}

export async function deleteSong(id: string): Promise<void> {
  await api.delete(`/api/songs/${id}`)
}

export async function updateSongContent(id: string, sections: SectionCreate[]): Promise<Song> {
  const response = await api.put<Song>(`/api/songs/${id}/content`, { sections })
  return response.data
}

export async function scrapeSong(data: ScrapeRequest): Promise<ScrapeResponse> {
  const response = await api.post<ScrapeResponse>('/api/scrape', data)
  return response.data
}

export async function getVoicingPreferences(): Promise<VoicingPreference[]> {
  const response = await api.get<VoicingPreference[]>('/api/songs/voicing-preferences')
  return response.data
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
  return response.data
}

export default api
