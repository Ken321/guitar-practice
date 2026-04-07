import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base, run_startup_migrations
from .routers import songs, scraper

# Create all tables on startup
Base.metadata.create_all(bind=engine)
run_startup_migrations()

app = FastAPI(title="Guitar Chord Practice API", version="1.0.0")


def _split_env_list(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


_base_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://localhost:3005",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]
_extra_origins = _split_env_list(os.getenv("CORS_ORIGINS", ""))
_origin_regexes = [
    # Allow this project's Vercel production/preview domains even if CORS_ORIGINS
    # was not configured in the hosting platform.
    r"^https://guitar-practice(?:-[a-zA-Z0-9-]+)?\.vercel\.app$",
    *_split_env_list(os.getenv("CORS_ORIGIN_REGEXES", "")),
]
_allow_origin_regex = "|".join(f"(?:{pattern})" for pattern in _origin_regexes)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_base_origins + _extra_origins,
    allow_origin_regex=_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songs.router, prefix="/api")
app.include_router(scraper.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "Guitar Chord Practice API"}
