from __future__ import annotations

import io
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent import run_agent
from tools import extract_pdf_text, inspect_dataset


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="K2Hackathon API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "K2Hackathon backend is running"}


@app.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Please upload a CSV file.")
    contents = await file.read()
    try:
        info = inspect_dataset(contents)
    except Exception as e:
        raise HTTPException(400, f"Could not read CSV: {e}")
    return {"filename": file.filename, **info}


@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF file.")
    contents = await file.read()
    try:
        info = extract_pdf_text(contents, max_chars=500)  # just metadata for preview
    except Exception as e:
        raise HTTPException(400, f"Could not read PDF: {e}")
    return {
        "filename": file.filename,
        "num_pages": info["num_pages"],
        "preview": info["pages"][0]["text"][:300] if info["pages"] else "",
    }


@app.post("/analyze")
async def analyze(
    paper: UploadFile = File(...),
    dataset: UploadFile = File(...),
):
    """
    Upload paper PDF + dataset CSV and stream the agent's SSE events.
    The frontend consumes this as an EventSource / fetch stream.
    """
    if not paper.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "paper must be a PDF.")
    if not dataset.filename.lower().endswith(".csv"):
        raise HTTPException(400, "dataset must be a CSV.")

    paper_bytes = await paper.read()
    csv_bytes = await dataset.read()

    async def event_stream():
        async for chunk in run_agent(paper_bytes, csv_bytes):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
