from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agents import run_backrooms
from agents.decide import GameState, decide
from game_state import LEVELS, clear_memory  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="K2Hackathon API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "K2Hackathon backend is running"}


@app.get("/levels")
def get_levels():
    return {"levels": [{"id": v["id"], "name": v["name"]} for v in LEVELS.values()]}


@app.post("/play/{level_id}")
async def play(level_id: int):
    async def event_stream():
        async for chunk in run_backrooms(level_id):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/agent/decide")
async def agent_decide(state: GameState):
    """K2 decides the next high-level intent based on the live game state."""
    async def event_stream():
        async for chunk in decide(state):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/reset")
def reset_memory():
    clear_memory()
    return {"status": "ok", "message": "Memory cleared."}
