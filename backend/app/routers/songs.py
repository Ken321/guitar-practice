from __future__ import annotations

from typing import List
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, load_only, joinedload
from ..database import get_db
from .. import models, schemas
from ..music_theory import normalize_capo_value, resolve_song_keys, estimate_key_from_sections

router = APIRouter(prefix="/songs", tags=["songs"])


def adjust_voicing_preference_count(
    db: Session,
    chord_name: str | None,
    voicing_signature: str | None,
    delta: int,
) -> None:
    if not chord_name or not voicing_signature or delta == 0:
        return

    preference = (
        db.query(models.VoicingPreference)
        .filter(
            models.VoicingPreference.chord_name == chord_name,
            models.VoicingPreference.voicing_signature == voicing_signature,
        )
        .first()
    )

    if preference is None:
        if delta > 0:
            db.add(models.VoicingPreference(
                chord_name=chord_name,
                voicing_signature=voicing_signature,
                usage_count=delta,
            ))
        return

    preference.usage_count += delta
    if preference.usage_count <= 0:
        db.delete(preference)


def should_track_voicing_preference(has_custom_voicing: bool, chord_name: str | None, voicing_signature: str | None) -> bool:
    return bool(has_custom_voicing and chord_name and voicing_signature)


def adjust_song_voicing_preference_counts(
    song: models.Song,
    db: Session,
    delta: int,
) -> None:
    for section in song.sections:
        for line in section.lines:
            for chord in line.chords:
                if should_track_voicing_preference(
                    chord.has_custom_voicing,
                    chord.preferred_voicing_chord_name,
                    chord.preferred_voicing_signature,
                ):
                    adjust_voicing_preference_count(
                        db,
                        chord.preferred_voicing_chord_name,
                        chord.preferred_voicing_signature,
                        delta,
                    )


@router.get("/voicing-preferences", response_model=List[schemas.VoicingPreferenceResponse])
def list_voicing_preferences(db: Session = Depends(get_db)):
    return (
        db.query(models.VoicingPreference)
        .filter(models.VoicingPreference.usage_count > 0)
        .order_by(
            models.VoicingPreference.chord_name.asc(),
            models.VoicingPreference.usage_count.desc(),
        )
        .all()
    )


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


@router.get("", response_model=List[schemas.SongListItemResponse])
def list_songs(db: Session = Depends(get_db)):
    songs = (
        db.query(models.Song)
        .options(
            load_only(
                models.Song.id,
                models.Song.title,
                models.Song.artist,
            )
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


@router.post("/estimate-key", response_model=schemas.EstimateKeyResponse)
def estimate_key_endpoint(request: schemas.EstimateKeyRequest):
    sections_data = [s.model_dump() for s in request.sections]
    original_key = estimate_key_from_sections(sections_data, capo=request.capo)
    return {"original_key": original_key}


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
    song = get_song_or_404(song_id, db)
    adjust_song_voicing_preference_counts(song, db, -1)
    db.delete(song)
    db.commit()


@router.put("/{song_id}/content", response_model=schemas.SongResponse)
def update_song_content(
    song_id: UUID,
    content: schemas.SongContentUpdate,
    db: Session = Depends(get_db)
):
    song = get_song_or_404(song_id, db)
    adjust_song_voicing_preference_counts(song, db, -1)

    # Delete existing sections (cascade deletes lines and chords)
    db.query(models.Section).filter(models.Section.song_id == song_id).delete()
    db.flush()

    # Create new sections, lines, chords
    for sec_data in sorted(content.sections, key=lambda section: section.order):
        section = models.Section(
            song_id=song_id,
            order=sec_data.order,
            label=sec_data.label,
        )
        db.add(section)
        db.flush()

        for line_data in sorted(sec_data.lines, key=lambda line: line.order):
            line = models.Line(
                section_id=section.id,
                order=line_data.order,
                lyrics=line_data.lyrics,
            )
            db.add(line)
            db.flush()

            for chord_data in sorted(line_data.chords, key=lambda chord: chord.position):
                chord = models.ChordPlacement(
                    line_id=line.id,
                    position=chord_data.position,
                    chord_name=chord_data.chord_name,
                    preferred_voicing=chord_data.preferred_voicing,
                    has_custom_voicing=chord_data.has_custom_voicing,
                    preferred_voicing_signature=chord_data.preferred_voicing_signature,
                    preferred_voicing_chord_name=chord_data.preferred_voicing_chord_name,
                )
                db.add(chord)
                if should_track_voicing_preference(
                    chord_data.has_custom_voicing,
                    chord_data.preferred_voicing_chord_name,
                    chord_data.preferred_voicing_signature,
                ):
                    adjust_voicing_preference_count(
                        db,
                        chord_data.preferred_voicing_chord_name,
                        chord_data.preferred_voicing_signature,
                        1,
                    )

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

    previous_signature = chord.preferred_voicing_signature
    previous_chord_name = chord.preferred_voicing_chord_name
    previous_has_custom_voicing = chord.has_custom_voicing
    next_signature = chord_in.preferred_voicing_signature
    next_chord_name = chord_in.preferred_voicing_chord_name
    next_has_custom_voicing = chord_in.has_custom_voicing

    if should_track_voicing_preference(previous_has_custom_voicing, previous_chord_name, previous_signature) and (
        not should_track_voicing_preference(next_has_custom_voicing, next_chord_name, next_signature)
        or previous_signature != next_signature
        or previous_chord_name != next_chord_name
    ):
        adjust_voicing_preference_count(db, previous_chord_name, previous_signature, -1)

    if should_track_voicing_preference(next_has_custom_voicing, next_chord_name, next_signature) and (
        not should_track_voicing_preference(previous_has_custom_voicing, previous_chord_name, previous_signature)
        or previous_signature != next_signature
        or previous_chord_name != next_chord_name
    ):
        adjust_voicing_preference_count(db, next_chord_name, next_signature, 1)

    chord.preferred_voicing = chord_in.preferred_voicing
    chord.has_custom_voicing = next_has_custom_voicing
    chord.preferred_voicing_signature = next_signature if next_has_custom_voicing else None
    chord.preferred_voicing_chord_name = next_chord_name if next_has_custom_voicing else None
    db.commit()
    db.refresh(chord)
    return chord
