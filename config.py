import os
from urllib.parse import urlparse


DEFAULT_ALLOWED_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]

SUPPORTED_HOST_SUFFIXES = {
    "bilibili.com",
    "b23.tv",
    "xiaohongshu.com",
    "xhslink.com",
}


def get_allowed_origins() -> list[str]:
    raw = os.getenv("VIDEO_AI_ALLOWED_ORIGINS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    return origins or DEFAULT_ALLOWED_ORIGINS


def extract_hostname(url: str) -> str:
    candidate = (url or "").strip()
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    return (parsed.hostname or "").lower()


def is_supported_host(url: str) -> bool:
    host = extract_hostname(url)
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in SUPPORTED_HOST_SUFFIXES)
