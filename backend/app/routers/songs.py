from typing import List
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from ..database import get_db
from .. import models, schemas
from ..music_theory import normalize_capo_value, resolve_song_keys

router = APIRouter(prefix="/songs", tags=["songs"])


def get_song_or_404(song_id: UUID, db: Session) -> models.Song:
    song = (
        db.query(models.Song)
        .options(
            joinedload(models.Song.sections)
            .joinedload(models.Section.lines)
            .joinedload(models.Line.chords)
        )
        .filter(models.Song.id == song_id)
        .first()
    )
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@router.get("", response_model=List[schemas.SongResponse])
def list_songs(db: Session = Depends(get_db)):
    songs = (
        db.query(models.Song)
        .options(
            joinedload(models.Song.sections)
            .joinedload(models.Section.lines)
            .joinedload(models.Line.chords)
        )
        .order_by(models.Song.created_at.desc())
        .all()
    )
    return songs


@router.post("", response_model=schemas.SongResponse, status_code=status.HTTP_201_CREATED)
def create_song(song_in: schemas.SongCreate, db: Session = Depends(get_db)):
    capo = normalize_capo_value(song_in.capo)
    chart_key, original_key = resolve_song_keys(song_in.key, song_in.original_key, capo)
    song = models.Song(
        title=song_in.title,
        artist=song_in.artist,
        key=chart_key or song_in.key,
        original_key=original_key or song_in.original_key,
        capo=capo,
        source_url=song_in.source_url,
    )
    db.add(song)
    db.commit()
    db.refresh(song)
    return get_song_or_404(song.id, db)


@router.get("/{song_id}", response_model=schemas.SongResponse)
def get_song(song_id: UUID, db: Session = Depends(get_db)):
    return get_song_or_404(song_id, db)


@router.put("/{song_id}", response_model=schemas.SongResponse)
def update_song(song_id: UUID, song_in: schemas.SongUpdate, db: Session = Depends(get_db)):
    song = get_song_or_404(song_id, db)
    update_data = song_in.model_dump(exclude_unset=True)

    if any(field in update_data for field in ("key", "original_key", "capo")):
        capo = normalize_capo_value(update_data.get("capo", song.capo))
        chart_key, original_key = resolve_song_keys(
            update_data.get("key", song.key),
            update_data.get("original_key", song.original_key),
            capo,
        )
        update_data["capo"] = capo
        if chart_key:
            update_data["key"] = chart_key
        if original_key:
            update_data["original_key"] = original_key

    for field, value in update_data.items():
        setattr(song, field, value)
    song.updated_at = datetime.utcnow()
    db.commit()
    return get_song_or_404(song_id, db)


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(song_id: UUID, db: Session = Depends(get_db)):
    song = db.query(models.Song).filter(models.Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    db.delete(song)
    db.commit()


@router.put("/{song_id}/content", response_model=schemas.SongResponse)
def update_song_content(
    song_id: UUID,
    content: schemas.SongContentUpdate,
    db: Session = Depends(get_db)
):
    song = db.query(models.Song).filter(models.Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    # Delete existing sections (cascade deletes lines and chords)
    db.query(models.Section).filter(models.Section.song_id == song_id).delete()
    db.flush()

    # Create new sections, lines, chords
    for sec_data in content.sections:
        section = models.Section(
            song_id=song_id,
            order=sec_data.order,
            label=sec_data.label,
        )
        db.add(section)
        db.flush()

        for line_data in sec_data.lines:
            line = models.Line(
                section_id=section.id,
                order=line_data.order,
                lyrics=line_data.lyrics,
            )
            db.add(line)
            db.flush()

            for chord_data in line_data.chords:
                chord = models.ChordPlacement(
                    line_id=line.id,
                    position=chord_data.position,
                    chord_name=chord_data.chord_name,
                    preferred_voicing=chord_data.preferred_voicing,
                )
                db.add(chord)

    song.updated_at = datetime.utcnow()
    db.commit()

    return get_song_or_404(song_id, db)


@router.patch("/{song_id}/chords/{chord_id}", response_model=schemas.ChordPlacementResponse)
def update_chord_voicing(
    song_id: UUID,
    chord_id: UUID,
    chord_in: schemas.ChordVoicingUpdate,
    db: Session = Depends(get_db),
):
    chord = (
        db.query(models.ChordPlacement)
        .join(models.Line, models.ChordPlacement.line_id == models.Line.id)
        .join(models.Section, models.Line.section_id == models.Section.id)
        .filter(
            models.ChordPlacement.id == chord_id,
            models.Section.song_id == song_id,
        )
        .first()
    )
    if not chord:
        raise HTTPException(status_code=404, detail="Chord placement not found")

    chord.preferred_voicing = chord_in.preferred_voicing
    db.commit()
    db.refresh(chord)
    return chord
