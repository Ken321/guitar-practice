from __future__ import annotations
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


# ChordPlacement schemas
class ChordPlacementCreate(BaseModel):
    position: int
    chord_name: str
    preferred_voicing: int = 0
    has_custom_voicing: bool = False
    preferred_voicing_signature: Optional[str] = None
    preferred_voicing_chord_name: Optional[str] = None


class ChordPlacementUpdate(BaseModel):
    position: Optional[int] = None
    chord_name: Optional[str] = None
    preferred_voicing: Optional[int] = None
    has_custom_voicing: Optional[bool] = None
    preferred_voicing_signature: Optional[str] = None
    preferred_voicing_chord_name: Optional[str] = None


class ChordVoicingUpdate(BaseModel):
    preferred_voicing: int
    has_custom_voicing: bool = True
    preferred_voicing_signature: Optional[str] = None
    preferred_voicing_chord_name: Optional[str] = None


class ChordPlacementResponse(BaseModel):
    id: UUID
    line_id: UUID
    position: int
    chord_name: str
    preferred_voicing: int
    has_custom_voicing: bool
    preferred_voicing_signature: Optional[str] = None
    preferred_voicing_chord_name: Optional[str] = None

    model_config = {"from_attributes": True}


class VoicingPreferenceResponse(BaseModel):
    chord_name: str
    voicing_signature: str
    usage_count: int

    model_config = {"from_attributes": True}


# Line schemas
class LineCreate(BaseModel):
    order: int = 0
    lyrics: str = ""
    chords: List[ChordPlacementCreate] = []


class LineResponse(BaseModel):
    id: UUID
    section_id: UUID
    order: int
    lyrics: str
    chords: List[ChordPlacementResponse] = []

    model_config = {"from_attributes": True}


# Section schemas
class SectionCreate(BaseModel):
    order: int = 0
    label: str = ""
    lines: List[LineCreate] = []


class SectionResponse(BaseModel):
    id: UUID
    song_id: UUID
    order: int
    label: str
    lines: List[LineResponse] = []

    model_config = {"from_attributes": True}


# Song schemas
class SongCreate(BaseModel):
    title: str
    artist: str
    key: str = "C"
    original_key: str = "C"
    capo: int = 0
    source_url: Optional[str] = None


class SongUpdate(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    key: Optional[str] = None
    original_key: Optional[str] = None
    capo: Optional[int] = None
    source_url: Optional[str] = None


class SongListItemResponse(BaseModel):
    id: UUID
    title: str
    artist: str

    model_config = {"from_attributes": True}


class SongResponse(BaseModel):
    id: UUID
    title: str
    artist: str
    key: str
    original_key: str
    capo: int
    source_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    sections: List[SectionResponse] = []

    model_config = {"from_attributes": True}


# Content update schema
class SongContentUpdate(BaseModel):
    sections: List[SectionCreate]


# Scraper schemas
class ScrapeRequest(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    url: Optional[str] = None


class ScrapeResponse(BaseModel):
    sections: List[SectionCreate]
    detected_key: Optional[str] = None
    detected_original_key: Optional[str] = None
    detected_capo: int = 0
    source_url: str
    detected_title: Optional[str] = None
    detected_artist: Optional[str] = None
