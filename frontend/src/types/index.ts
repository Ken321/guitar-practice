export interface ChordPlacement {
  id: string
  line_id: string
  position: number
  chord_name: string
  preferred_voicing: number
  has_custom_voicing: boolean
  preferred_voicing_signature?: string | null
  preferred_voicing_chord_name?: string | null
}

export interface VoicingPreference {
  chord_name: string
  voicing_signature: string
  usage_count: number
}

export interface Line {
  id: string
  section_id: string
  order: number
  lyrics: string
  chords: ChordPlacement[]
}

export interface Section {
  id: string
  song_id: string
  order: number
  label: string
  lines: Line[]
}

export interface Song {
  id: string
  title: string
  artist: string
  key: string
  original_key: string
  capo: number
  source_url: string | null
  created_at: string
  updated_at: string
  sections: Section[]
}

export interface SongListItem {
  id: string
  title: string
  artist: string
}

// For creating/editing - no IDs required
export interface ChordPlacementCreate {
  position: number
  chord_name: string
  preferred_voicing: number
  has_custom_voicing?: boolean
  preferred_voicing_signature?: string | null
  preferred_voicing_chord_name?: string | null
}

export interface LineCreate {
  order: number
  lyrics: string
  chords: ChordPlacementCreate[]
}

export interface SectionCreate {
  order: number
  label: string
  lines: LineCreate[]
}

export interface SongCreate {
  title: string
  artist: string
  key: string
  original_key: string
  capo: number
  source_url?: string | null
}

export interface SongUpdate {
  title?: string
  artist?: string
  key?: string
  original_key?: string
  capo?: number
  source_url?: string | null
}

export interface ScrapeRequest {
  title?: string
  artist?: string
  url?: string
}

export interface ScrapeResponse {
  sections: SectionCreate[]
  detected_key: string | null
  detected_original_key: string | null
  detected_capo: number
  source_url: string
  detected_title?: string | null
  detected_artist?: string | null
}

export type DisplayMode = 'chord' | 'degree'
