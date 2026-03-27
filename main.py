import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import extract_hostname, get_allowed_origins, is_supported_host
from platforms import BilibiliParser, XiaohongshuParser
from summarizer import Summarizer
from transcriber import Transcriber
from video_downloader import VideoDownloader


PROJECT_DIR = Path(__file__).parent
STATIC_DIR = PROJECT_DIR / "static"
OUTPUTS_DIR = PROJECT_DIR / "outputs"
TMP_DIR = PROJECT_DIR / "runtime_tmp"

STATIC_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)
TMP_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Video AI Summary")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class SummarizeRequest(BaseModel):
    url: str
    depth: str = "simple"


class SummarizeResponse(BaseModel):
    summary: str
    task_id: str


tasks: dict[str, dict] = {}


def get_platform_parser(url: str):
    if XiaohongshuParser.is_support(url):
        return XiaohongshuParser
    if BilibiliParser.is_support(url):
        return BilibiliParser

    host = extract_hostname(url)
    if host.endswith(".bilibili.com") or host == "bilibili.com" or host == "b23.tv":
        return BilibiliParser
    if host.endswith(".xiaohongshu.com") or host == "xiaohongshu.com" or host == "xhslink.com":
        return XiaohongshuParser
    return None


def update_task(
    task_id: str,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    stage: Optional[str] = None,
    message: Optional[str] = None,
    result: Optional[str] = None,
    transcript: Optional[str] = None,
    segments: Optional[list] = None,
    video_title: Optional[str] = None,
    timing: Optional[dict] = None,
    token_usage: Optional[int] = None,
):
    task = tasks.get(task_id)
    if not task:
        return
    if status is not None:
        task["status"] = status
    if progress is not None:
        task["progress"] = progress
    if stage is not None:
        task["stage"] = stage
    if message is not None:
        task["message"] = message
    if result is not None:
        task["result"] = result
    if transcript is not None:
        task["transcript"] = transcript
    if segments is not None:
        task["segments"] = segments
    if video_title is not None:
        task["video_title"] = video_title
    if timing is not None:
        task["timing"] = timing
    if token_usage is not None:
        task["token_usage"] = token_usage


def extract_audio(video_path: str, output_dir: str) -> str:
    audio_path = os.path.join(output_dir, "audio.mp3")
    cmd = [
        "ffmpeg",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "2",
        "-y",
        audio_path,
    ]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg not found in PATH.") from exc

    if completed.returncode != 0:
        err = (completed.stderr or "").strip()
        raise RuntimeError(f"ffmpeg failed: {err or 'unknown error'}")

    if not os.path.exists(audio_path):
        raise RuntimeError("audio file not generated.")
    return audio_path


async def process_video(task_id: str, raw_url: str, depth: str):
    task_out = OUTPUTS_DIR / task_id
    task_out.mkdir(parents=True, exist_ok=True)
    temp_dir = tempfile.mkdtemp(dir=str(TMP_DIR))
    timing = {"total_start": time.time()}

    try:
        update_task(task_id, status="processing", progress=0, stage="preparing", message="parsing link")

        url = raw_url.strip()
        if not is_supported_host(url):
            raise ValueError("Unsupported link host.")

        parser = get_platform_parser(url)
        if not parser:
            raise ValueError("Unsupported link. Only Bilibili and Xiaohongshu are supported.")
        normalized_url = parser.get_yt_dlp_format(url)

        update_task(task_id, progress=5, stage="downloading", message="downloading video")
        downloader = VideoDownloader(output_dir=temp_dir)

        def on_download(percent: str, speed: str, eta: str):
            del eta
            try:
                p = int(float(str(percent).replace("%", "").strip()))
            except Exception:
                p = 0
            progress = max(5, min(30, 5 + int(p * 0.25)))
            update_task(
                task_id,
                progress=progress,
                stage="downloading",
                message=f"Downloading {percent} - speed: {speed}",
            )

        ts = time.time()
        video_path, info = await asyncio.to_thread(downloader.download, normalized_url, on_download)
        timing["download"] = round(time.time() - ts, 2)
        update_task(task_id, progress=30, stage="downloading", message="download complete")

        info_data = {
            "task_id": task_id,
            "url": url,
            "normalized_url": normalized_url,
            "platform": info.get("platform"),
            "title": info.get("title"),
            "uploader": info.get("uploader"),
            "duration": info.get("duration"),
            "created_at": datetime.now().isoformat(),
        }
        with open(task_out / "info.json", "w", encoding="utf-8") as f:
            json.dump(info_data, f, ensure_ascii=False, indent=2)

        update_task(task_id, progress=35, stage="extracting_audio", message="extracting audio")
        ts = time.time()
        audio_path = await asyncio.to_thread(extract_audio, video_path, temp_dir)
        timing["audio_extract"] = round(time.time() - ts, 2)
        update_task(task_id, progress=45, stage="extracting_audio", message="audio extracted")

        update_task(task_id, progress=50, stage="transcribing", message="loading whisper")
        # Whisper model loading is heavy; run in worker thread to avoid blocking the event loop.
        transcriber = await asyncio.to_thread(Transcriber, "base", "zh")
        update_task(task_id, progress=55, stage="transcribing", message="transcribing")

        def on_transcribe(status: str):
            update_task(task_id, progress=60, stage="transcribing", message=f"transcribing: {status}")

        ts = time.time()
        segments = await asyncio.to_thread(transcriber.transcribe_with_segments, audio_path, on_transcribe)
        text = " ".join(seg["text"] for seg in segments).strip()
        timing["transcribe"] = round(time.time() - ts, 2)

        if len(text) < 10:
            raise ValueError("transcript too short.")

        with open(task_out / "transcript.txt", "w", encoding="utf-8") as f:
            f.write(text)
        with open(task_out / "segments.json", "w", encoding="utf-8") as f:
            json.dump(segments, f, ensure_ascii=False, indent=2)

        title = info.get("title", "Untitled")
        update_task(
            task_id,
            progress=75,
            stage="transcribe_completed",
            message=f"transcribe complete, chars={len(text)}",
            transcript=text,
            segments=segments,
            video_title=title,
            timing=timing,
        )

        update_task(task_id, progress=80, stage="summarizing", message="requesting AI summary")
        summarizer = Summarizer(provider="minimax")

        def on_summary(status: str):
            update_task(task_id, progress=90, stage="summarizing", message=f"AI summary: {status}")

        ts = time.time()
        summary, token_usage = await asyncio.to_thread(summarizer.summarize, text, on_summary, depth)
        timing["summarize"] = round(time.time() - ts, 2)
        timing["total"] = round(time.time() - timing["total_start"], 2)

        with open(task_out / "summary.txt", "w", encoding="utf-8") as f:
            f.write(summary)

        update_task(
            task_id,
            status="completed",
            progress=100,
            stage="completed",
            message="completed",
            result=summary,
            transcript=text,
            segments=segments,
            video_title=title,
            timing=timing,
            token_usage=token_usage,
        )
    except Exception as exc:
        update_task(
            task_id,
            status="failed",
            stage="failed",
            message=f"Processing failed: {exc}",
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest):
    url = req.url.strip()
    parser = get_platform_parser(url)
    if not parser:
        raise HTTPException(status_code=400, detail="Unsupported link.")

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "progress": 0,
        "stage": "queued",
        "message": "waiting...",
        "result": None,
        "transcript": None,
        "segments": None,
        "video_title": None,
        "timing": None,
        "token_usage": None,
    }
    asyncio.create_task(process_video(task_id, url, req.depth))
    return SummarizeResponse(summary="", task_id=task_id)


@app.get("/api/status/{task_id}")
async def status(task_id: str):
    item = tasks.get(task_id)
    if not item:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "status": item["status"],
        "progress": item["progress"],
        "stage": item["stage"],
        "message": item["message"],
        "result": item.get("result"),
        "transcript": item.get("transcript"),
        "segments": item.get("segments"),
        "video_title": item.get("video_title"),
        "timing": item.get("timing"),
        "token_usage": item.get("token_usage"),
    }


@app.get("/api/result/{task_id}")
async def result(task_id: str):
    item = tasks.get(task_id)
    if not item:
        raise HTTPException(status_code=404, detail="Task not found")
    if item["status"] == "failed":
        raise HTTPException(status_code=500, detail=item["message"])
    if item["status"] != "completed":
        raise HTTPException(status_code=202, detail="Task is still processing")
    return {"summary": item["result"]}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
