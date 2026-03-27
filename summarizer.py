import os
from typing import Callable, Optional

from anthropic import Anthropic


DEPTH_MAX_TOKENS = {
    "simple": 1024,
    "deep": 4096,
}


class Summarizer:
    def __init__(self, provider: str = "minimax"):
        self.provider = provider
        if provider != "minimax":
            raise ValueError("Only minimax provider is supported in this build.")

        key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not key:
            raise ValueError("Missing ANTHROPIC_API_KEY in environment.")

        self.client = Anthropic(
            api_key=key,
            base_url="https://api.minimaxi.com/anthropic",
        )
        self.model = "MiniMax-M2.7"

    def summarize(
        self,
        text: str,
        progress_callback: Optional[Callable] = None,
        depth: str = "simple",
    ) -> tuple[str, int]:
        if not text.strip():
            return "转写内容为空，无法总结。", 0

        if progress_callback:
            progress_callback("building prompt")

        prompt = self._build_prompt(text, depth)
        max_tokens = DEPTH_MAX_TOKENS.get(depth, DEPTH_MAX_TOKENS["simple"])

        resp = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system="你是一个严谨的中文内容总结助手，不编造，不夸张。",
            messages=[{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        )

        if progress_callback:
            progress_callback("summary generated")

        parts = []
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                parts.append(block.text)
        result = "".join(parts).strip() or "模型返回了空内容。"
        usage = getattr(resp, "usage", None)
        output_tokens = getattr(usage, "output_tokens", 0) if usage else 0
        return result, int(output_tokens)

    def _build_prompt(self, text: str, depth: str) -> str:
        if depth == "deep":
            return (
                "请对以下视频转写做深度分析：\n"
                "1) 主题概述\n"
                "2) 核心观点与论据\n"
                "3) 结论与建议\n"
                "4) 可能的局限和风险\n\n"
                "输出结构：\n"
                "## 主题概述\n"
                "## 核心观点\n"
                "## 结论与建议\n"
                "## 局限与风险\n\n"
                f"转写内容：\n{text}"
            )
        return (
            "请对以下视频转写做简洁总结：\n"
            "1) 先写一段整体概述\n"
            "2) 列出3-5条关键要点\n"
            "3) 提炼明确结论\n\n"
            "输出结构：\n"
            "## 视频概述\n"
            "## 关键要点\n"
            "- 要点1\n"
            "- 要点2\n"
            "## 结论\n\n"
            f"转写内容：\n{text}"
        )
