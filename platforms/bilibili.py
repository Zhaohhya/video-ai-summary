import re
from typing import Optional


class BilibiliParser:
    VIDEO_PATTERN = re.compile(
        r"(?:https?://)?(?:www\.|m\.)?bilibili\.com/(?:video|short)/(?P<id>[A-Za-z0-9]+)",
        re.IGNORECASE,
    )
    SHORT_LINK_PATTERN = re.compile(
        r"(?:https?://)?(?:www\.)?b23\.tv/[A-Za-z0-9]+",
        re.IGNORECASE,
    )

    @staticmethod
    def is_support(url: str) -> bool:
        return bool(
            BilibiliParser.VIDEO_PATTERN.search(url)
            or BilibiliParser.SHORT_LINK_PATTERN.search(url)
            or "bilibili.com" in (url or "").lower()
            or "b23.tv" in (url or "").lower()
        )

    @staticmethod
    def extract_id(url: str) -> Optional[str]:
        match = BilibiliParser.VIDEO_PATTERN.search(url)
        if not match:
            return None
        value = match.group("id")
        if not value:
            return None
        return value if value.lower().startswith("bv") else f"BV{value}"

    @staticmethod
    def get_yt_dlp_format(url: str) -> str:
        if BilibiliParser.SHORT_LINK_PATTERN.search(url):
            return url
        video_id = BilibiliParser.extract_id(url)
        if video_id:
            return f"https://www.bilibili.com/video/{video_id}"
        return url
