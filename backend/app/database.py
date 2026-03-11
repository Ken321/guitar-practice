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

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def run_startup_migrations():
    inspector = inspect(engine)
    if "songs" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("songs")}
    if "capo" in columns:
        if "original_key" in columns:
            return

    with engine.begin() as connection:
        if "capo" not in columns:
            connection.execute(text("ALTER TABLE songs ADD COLUMN capo INTEGER NOT NULL DEFAULT 0"))
        if "original_key" not in columns:
            connection.execute(text("ALTER TABLE songs ADD COLUMN original_key VARCHAR(20)"))
        connection.execute(text("UPDATE songs SET original_key = key WHERE original_key IS NULL"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
