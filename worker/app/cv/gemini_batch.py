import base64
import json
import logging
import os
import re
import time
from typing import Any, Dict, List
import cv2
import numpy as np

logger = logging.getLogger(__name__)

def _numpy_to_jpeg_b64(img: np.ndarray, padding_px: int = 4) -> str:
    padded = cv2.copyMakeBorder(img, padding_px, padding_px, padding_px, padding_px,
                                 cv2.BORDER_CONSTANT, value=(255, 255, 255))
    h, w = padded.shape[:2]
    if max(h, w) < 80:
        scale = 80 / max(h, w)
        padded = cv2.resize(padded, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    _, buf = cv2.imencode(".jpg", padded, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return base64.b64encode(buf.tobytes()).decode()

def extract_answers_batch_gemini(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Send all cropped images for a submission in a SINGLE Gemini request.
    tasks is a list of dicts:
      {
         "id": str,
         "type": "checkbox" or "text",
         "crop": np.ndarray,
         "label": str (optional)
      }
    Returns dict: { task_id: {"checked": bool, "text": str, "confidence": float} }
    """
    if not tasks:
        return {}

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set - skipping batch extraction")
        return {t["id"]: {"checked": False, "text": "", "confidence": 0.0} for t in tasks}

    logger.info(f"Gemini API Key detected (prefix: {api_key[:4]}...)")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    
    content_parts = []
    content_parts.append(
        "You are a survey transcriber. I am providing cropped images of checkboxes and text boxes from a filled survey.\n"
        "For each image, I will specify if it is a 'checkbox' or a 'text' box, and its ID.\n\n"
    )

    for idx, task in enumerate(tasks):
        t_type = task["type"]
        t_id = task["id"]
        label = task.get("label", "")
        
        desc = f"\n--- Image {idx+1} ---\nID: {t_id}\nType: {t_type}"
        if label:
            desc += f"\nLabel Context: {label}"
        content_parts.append(desc)
        
        img_b64 = _numpy_to_jpeg_b64(task["crop"])
        content_parts.append(types.Part.from_bytes(data=base64.b64decode(img_b64), mime_type="image/jpeg"))

    content_parts.append(
        "\n\nReturn ONLY a valid JSON array of objects, one for each image in the same order.\n"
        "Each object must have exactly these keys:\n"
        "- 'id': string (must match the ID provided)\n"
        "- 'checked': boolean (only for 'checkbox' type; true if filled/ticked/crossed/marked in any way, false if empty/blank)\n"
        "- 'text': string (only for 'text' type; transcribe the handwritten or typed text, empty string if blank)\n"
        "- 'confidence': float (between 0.0 and 1.0, 0.95 if you are sure, 0.5 if ambiguous)"
    )

    max_retries = 3
    response = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=content_parts,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            break
        except Exception as e:
            err_str = str(e).upper()
            if any(x in err_str for x in ["429", "RESOURCE_EXHAUSTED", "503", "SERVICE_UNAVAILABLE", "UNAVAILABLE"]):
                wait = (attempt + 1) * 20
                if attempt < max_retries - 1:
                    logger.warning(f"Gemini error ({err_str[:20]}...). Retry {attempt+1}/{max_retries} in {wait}s...")
                    time.sleep(wait)
                    continue
            logger.error(f"Gemini API error: {e}")
            raise

    if not response:
        return {t["id"]: {"checked": False, "text": "", "confidence": 0.0} for t in tasks}

    raw = response.text.strip()
    # No more markdown stripping needed

    try:
        results_list = json.loads(raw)
        results_dict = {r["id"]: r for r in results_list}
        return results_dict
    except Exception as e:
        logger.error(f"Failed to parse Gemini batch response: {e}\nRaw: {raw}")
        return {t["id"]: {"checked": False, "text": "", "confidence": 0.0} for t in tasks}
