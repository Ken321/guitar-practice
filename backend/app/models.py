import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, Text, UniqueConstraint, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from .database import Base


class Song(Base):
    __tablename__ = "songs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(255), nullable=False)
    artist = Column(String(255), nullable=False)
    key = Column(String(20), nullable=False, default="C")
    original_key = Column(String(20), nullable=False, default="C")
    capo = Column(Integer, nullable=False, default=0)
    source_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    sections = relationship(
        "Section",
        back_populates="song",
        cascade="all, delete-orphan",
        order_by="Section.order"
    )


class Section(Base):
    __tablename__ = "sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_id = Column(UUID(as_uuid=True), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False)
    order = Column(Integer, nullable=False, default=0)
    label = Column(String(100), nullable=False, default="")

    song = relationship("Song", back_populates="sections")
    lines = relationship(
        "Line",
        back_populates="section",
        cascade="all, delete-orphan",
        order_by="Line.order"
    )


class Line(Base):
    __tablename__ = "lines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    section_id = Column(UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False)
    order = Column(Integer, nullable=False, default=0)
    lyrics = Column(Text, nullable=False, default="")

    section = relationship("Section", back_populates="lines")
    chords = relationship(
        "ChordPlacement",
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="ChordPlacement.position"
    )


class ChordPlacement(Base):
    __tablename__ = "chord_placements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    line_id = Column(UUID(as_uuid=True), ForeignKey("lines.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    chord_name = Column(String(50), nullable=False)
    preferred_voicing = Column(Integer, nullable=False, default=0)
    has_custom_voicing = Column(Boolean, nullable=False, default=False)
    preferred_voicing_signature = Column(String(100), nullable=True)
    preferred_voicing_chord_name = Column(String(50), nullable=True)

    line = relationship("Line", back_populates="chords")


class VoicingPreference(Base):
    __tablename__ = "voicing_preferences"
    __table_args__ = (
        UniqueConstraint("chord_name", "voicing_signature", name="uq_voicing_preferences_chord_signature"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chord_name = Column(String(50), nullable=False)
    voicing_signature = Column(String(100), nullable=False)
    usage_count = Column(Integer, nullable=False, default=0)
