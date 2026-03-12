import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# backend/.env を自動ロード（ローカル開発用）
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL が設定されていません。backend/.env を作成してください。")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def run_startup_migrations():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "songs" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("songs")}

    with engine.begin() as connection:
        if "capo" not in columns:
            connection.execute(text("ALTER TABLE songs ADD COLUMN capo INTEGER NOT NULL DEFAULT 0"))
        if "original_key" not in columns:
            connection.execute(text("ALTER TABLE songs ADD COLUMN original_key VARCHAR(20)"))
        connection.execute(text("UPDATE songs SET original_key = key WHERE original_key IS NULL"))

        if "chord_placements" in table_names:
            chord_columns = {column["name"] for column in inspector.get_columns("chord_placements")}
            if "has_custom_voicing" not in chord_columns:
                connection.execute(text("ALTER TABLE chord_placements ADD COLUMN has_custom_voicing BOOLEAN NOT NULL DEFAULT FALSE"))
            if "preferred_voicing_signature" not in chord_columns:
                connection.execute(text("ALTER TABLE chord_placements ADD COLUMN preferred_voicing_signature VARCHAR(100)"))
            if "preferred_voicing_chord_name" not in chord_columns:
                connection.execute(text("ALTER TABLE chord_placements ADD COLUMN preferred_voicing_chord_name VARCHAR(50)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
