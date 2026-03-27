import os
import re
import tempfile
import time
from typing import Callable, Optional

import yt_dlp


def _clean(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    text = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", text)
    return text.strip()


class VideoDownloader:
    def __init__(self, output_dir: Optional[str] = None):
        self.output_dir = output_dir or tempfile.mkdtemp()

    def download(
        self,
        url: str,
        progress_callback: Optional[Callable] = None,
        max_retries: int = 3,
    ) -> tuple[str, dict]:
        last_error = None
        for attempt in range(max_retries):
            try:
                return self._download_once(url, progress_callback)
            except Exception as exc:
                last_error = exc
                if attempt < max_retries - 1:
                    wait_seconds = 3 + attempt * 3
                    if progress_callback:
                        progress_callback(f"retrying in {wait_seconds}s", "", "")
                    time.sleep(wait_seconds)
        raise RuntimeError(self._friendly_error(last_error))

    def _download_once(
        self,
        url: str,
        progress_callback: Optional[Callable],
    ) -> tuple[str, dict]:
        ydl_opts = {
            "format": "bv*+ba/best",
            "outtmpl": os.path.join(self.output_dir, "%(title).120s.%(ext)s"),
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
            "retries": 5,
            "fragment_retries": 5,
            "socket_timeout": 30,
            "noplaylist": True,
            "http_headers": {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
            },
        }

        if progress_callback:
            ydl_opts["progress_hooks"] = [self._make_progress_hook(progress_callback)]

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            video_path = self._resolve_final_path(ydl, info)

        meta = {
            "title": info.get("title") or "Untitled",
            "duration": info.get("duration") or 0,
            "uploader": info.get("uploader") or "Unknown",
            "platform": self._detect_platform(url),
        }
        return video_path, meta

    def _resolve_final_path(self, ydl: yt_dlp.YoutubeDL, info: dict) -> str:
        prepared = ydl.prepare_filename(info)
        if os.path.exists(prepared):
            return prepared

        requested = info.get("requested_downloads") or []
        for item in requested:
            candidate = item.get("filepath") or item.get("_filename")
            if candidate and os.path.exists(candidate):
                return candidate

        base, _ = os.path.splitext(prepared)
        mp4 = f"{base}.mp4"
        if os.path.exists(mp4):
            return mp4

        raise RuntimeError("Downloaded file not found.")

    def _make_progress_hook(self, callback: Callable):
        def hook(payload: dict):
            status = payload.get("status")
            if status == "downloading":
                percent = _clean(payload.get("_percent_str", "0%"))
                speed = _clean(payload.get("_speed_str", "N/A"))
                eta = _clean(payload.get("_eta_str", "N/A"))
                callback(percent, speed, eta)
            elif status == "finished":
                callback("100%", "done", "0s")

        return hook

    @staticmethod
    def _detect_platform(url: str) -> str:
        lowered = (url or "").lower()
        if "bilibili" in lowered or "b23.tv" in lowered:
            return "Bilibili"
        if "xiaohongshu" in lowered or "xhslink.com" in lowered:
            return "Xiaohongshu"
        return "Unknown"

    @staticmethod
    def _friendly_error(err: Exception) -> str:
        raw = str(err or "")
        if "WinError 10013" in raw:
            return (
                "Download failed: network connection is blocked by local policy "
                "(WinError 10013). Please check Windows Firewall/antivirus/proxy software "
                "and allow python.exe outbound HTTPS access."
            )
        return f"Download failed: {raw}"
