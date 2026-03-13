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
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3005",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songs.router, prefix="/api")
app.include_router(scraper.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "Guitar Chord Practice API"}
