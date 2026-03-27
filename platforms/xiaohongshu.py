import re
from typing import Optional


class XiaohongshuParser:
    NOTE_PATTERN = re.compile(
        r"(?:https?://)?(?:www\.)?xiaohongshu\.com/(?:note|explore|discovery/item)/(?P<id>[A-Za-z0-9]+)",
        re.IGNORECASE,
    )
    SHORT_LINK_PATTERN = re.compile(
        r"(?:https?://)?(?:www\.)?xhslink\.com/[A-Za-z0-9]+",
        re.IGNORECASE,
    )

    @staticmethod
    def is_support(url: str) -> bool:
        return bool(
            XiaohongshuParser.NOTE_PATTERN.search(url)
            or XiaohongshuParser.SHORT_LINK_PATTERN.search(url)
            or "xiaohongshu.com" in (url or "").lower()
            or "xhslink.com" in (url or "").lower()
        )

    @staticmethod
    def extract_id(url: str) -> Optional[str]:
        match = XiaohongshuParser.NOTE_PATTERN.search(url)
        return match.group("id") if match else None

    @staticmethod
    def get_yt_dlp_format(url: str) -> str:
        if XiaohongshuParser.SHORT_LINK_PATTERN.search(url):
            return url
        note_id = XiaohongshuParser.extract_id(url)
        if note_id:
            return f"https://www.xiaohongshu.com/explore/{note_id}"
        return url
