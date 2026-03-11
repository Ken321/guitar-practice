from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base, run_startup_migrations
from .routers import songs, scraper

# Create all tables on startup
Base.metadata.create_all(bind=engine)
run_startup_migrations()

app = FastAPI(title="Guitar Chord Practice API", version="1.0.0")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songs.router, prefix="/api")
app.include_router(scraper.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "Guitar Chord Practice API"}
