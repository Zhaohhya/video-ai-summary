from typing import Callable, Optional

import whisper


class Transcriber:
    def __init__(self, model_name: str = "base", language: str = "zh"):
        self.language = language
        self.model = whisper.load_model(model_name)

    def transcribe_with_segments(
        self,
        audio_path: str,
        progress_callback: Optional[Callable] = None,
    ) -> list[dict]:
        if progress_callback:
            progress_callback("model loaded")

        result = self.model.transcribe(
            audio_path,
            language=self.language,
            task="transcribe",
            verbose=False,
            fp16=False,
        )

        segments = []
        for seg in result.get("segments", []):
            segments.append(
                {
                    "start": float(seg["start"]),
                    "end": float(seg["end"]),
                    "text": str(seg.get("text", "")).strip(),
                }
            )
        return segments
