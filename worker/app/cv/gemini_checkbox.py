"""
Gemini Vision checkbox detector.

Uses Google Gemini Flash (free tier: 1,500 req/day) to determine whether a
cropped checkbox region is checked or unchecked.

Set GEMINI_API_KEY in worker/.env to enable.  Falls back to the CV
fill-ratio detector automatically if the key is absent or the API call fails.
"""
import base64
import io
import logging
import os
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_GEMINI_MODEL = "gemini-flash-latest"

# Prompt sent for each checkbox crop
_PROMPT = (
    "Look at this cropped image of a survey checkbox. "
    "Is it CHECKED (filled in, has a mark, tick, cross, or any ink inside)? "
    "Return JSON: {\"checked\": boolean}"
)


def _numpy_to_jpeg_b64(img: np.ndarray, padding_px: int = 4) -> str:
    """Convert a BGR numpy array to a base64-encoded JPEG string."""
    # Add white padding so tiny crops aren't ambiguous
    padded = cv2.copyMakeBorder(img, padding_px, padding_px, padding_px, padding_px,
                                 cv2.BORDER_CONSTANT, value=(255, 255, 255))
    # Upscale small crops so the model has enough detail
    h, w = padded.shape[:2]
    if max(h, w) < 80:
        scale = 80 / max(h, w)
        padded = cv2.resize(padded, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)

    _, buf = cv2.imencode(".jpg", padded, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return base64.b64encode(buf.tobytes()).decode()


@dataclass
class GeminiCheckboxResult:
    checked: bool
    confidence: float   # always 0.95 on success, 0.5 on fallback
    fill_ratio: float   # kept for API compatibility (0 when using vision)
    net_fill: float     # kept for API compatibility


def detect_checkbox_gemini(
    crop: np.ndarray,
    option_label: str = "",
    fallback_result: Optional[object] = None,  # kept for API compat, ignored
) -> GeminiCheckboxResult:
    """
    Ask Gemini Flash whether the checkbox crop is checked.
    No CV fallback — if Gemini is unavailable, returns unchecked with 0 confidence
    so the response is flagged as NEEDS_REVIEW.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set — checkbox detection skipped, marking needs review")
        return GeminiCheckboxResult(checked=False, confidence=0.0, fill_ratio=0.0, net_fill=0.0)
    
    logger.info(f"Gemini API Key detected (prefix: {api_key[:4]}...)")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        img_b64 = _numpy_to_jpeg_b64(crop)
        prompt = _PROMPT
        if option_label:
            prompt = (
                f"Look at this cropped image of a survey checkbox for the option '{option_label}'. "
                "Is it CHECKED (filled in, has a mark, tick, cross, or any ink inside)? "
                "Return JSON: {\"checked\": boolean}"
            )

        response = client.models.generate_content(
            model=_GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(
                    data=base64.b64decode(img_b64),
                    mime_type="image/jpeg",
                ),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        import json
        res_data = json.loads(response.text.strip())
        checked = bool(res_data.get("checked", False))
        logger.debug(f"Gemini says checked={checked} for option '{option_label}'")

        return GeminiCheckboxResult(
            checked=checked,
            confidence=0.95,
            fill_ratio=0.0,
            net_fill=0.0,
        )

    except Exception as e:
        logger.warning(f"Gemini checkbox detection failed ({e}) — marking as needs review")
        return GeminiCheckboxResult(checked=False, confidence=0.0, fill_ratio=0.0, net_fill=0.0)
