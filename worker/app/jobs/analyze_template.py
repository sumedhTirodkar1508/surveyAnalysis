"""
AI-powered survey question extraction from template page images.

Sends ALL rendered pages in a SINGLE Gemini Vision request (1 API call total).
Uses the stable gemini-1.5-flash model with JSON enforcement and retries.
"""
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

# Load env vars
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

logger = logging.getLogger(__name__)

QUESTION_TYPE_MAP = {
    "MULTI_SELECT": "MULTI_SELECT",
    "SINGLE_SELECT": "SINGLE_SELECT",
    "MATRIX_SINGLE_SELECT": "MATRIX_SINGLE_SELECT",
    "MATRIX_MULTI_SELECT": "MATRIX_MULTI_SELECT",
    "FREE_TEXT": "FREE_TEXT",
    "NAME": "NAME",
    "OTHER_TEXT": "OTHER_TEXT",
}

EXTRACTION_PROMPT = """
You are analyzing a multi-page survey form. The images provided are the pages IN ORDER.
Extract ALL questions across ALL pages. For EACH question return a JSON object with:
- "questionNumber": string (e.g. "1", "2", "3a")
- "questionText": string (the full question text)
- "questionType": one of: "MULTI_SELECT", "SINGLE_SELECT", "MATRIX_SINGLE_SELECT", "MATRIX_MULTI_SELECT", "FREE_TEXT", "NAME", "OTHER_TEXT"
- "options": array of strings (MULTI_SELECT / SINGLE_SELECT only)
- "matrixRows": array of strings (MATRIX types)
- "matrixColumns": array of strings (MATRIX types)

Return ONLY a valid JSON array of objects.
"""

def _extract_questions_single_request(page_image_bytes: list[bytes]) -> list[dict]:
    """Send all pages to Gemini in one request with exponential backoff retries."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set — skipping AI question extraction")
        return []
    
    logger.info(f"Gemini API Key detected (prefix: {api_key[:4]}...)")
    logger.info(f"Sending {len(page_image_bytes)} page(s) to Gemini in one request…")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # Build multimodal content
        content_parts = []
        for png_bytes in page_image_bytes:
            content_parts.append(types.Part.from_bytes(data=png_bytes, mime_type="image/png"))
        content_parts.append(EXTRACTION_PROMPT)

        # Basic retry logic for 429s
        max_retries = 3
        response = None
        for attempt in range(max_retries):
            try:
                # Using gemini-2.5-flash as requested to avoid 'latest' alias congestion
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
                    wait = (attempt + 1) * 20  # 20s, 40s, 60s
                    if attempt < max_retries - 1:
                        logger.warning(f"Gemini error ({err_str[:20]}...). Retry {attempt+1}/{max_retries} in {wait}s...")
                        time.sleep(wait)
                        continue
                logger.error(f"Gemini API error: {e}")
                raise

        if not response:
            return []

        # Parse JSON
        raw = response.text.strip()
        logger.info(f"Raw Gemini JSON response: {raw}")
        questions = json.loads(raw)
        if not isinstance(questions, list):
            logger.warning(f"Gemini returned non-list type: {type(questions)}")
            return []

        logger.info(f"Gemini extracted {len(questions)} question(s)")
        return questions

    except Exception as e:
        logger.error(f"Gemini extraction failed: {e}")
        return []

async def extract_and_save_questions(conn, version_id: str, page_image_bytes: list[bytes]) -> int:
    """Entry point for the worker job."""
    # Check if questions already exist
    existing = await conn.fetchval('SELECT COUNT(*) FROM "SurveyQuestion" WHERE "surveyVersionId" = $1', version_id)
    if existing and existing > 0:
        logger.info(f"Version {version_id} already has {existing} questions — skipping")
        return 0

    questions = _extract_questions_single_request(page_image_bytes)
    if not questions:
        return 0

    saved = 0
    for order, q in enumerate(questions):
        q_type = QUESTION_TYPE_MAP.get(str(q.get("questionType", "")), "FREE_TEXT")
        options = q.get("options")
        matrix_rows = q.get("matrixRows")
        matrix_cols = q.get("matrixColumns")

        await conn.execute(
            """
            INSERT INTO "SurveyQuestion" (
                id, "surveyVersionId", "questionNumber", "questionText",
                "questionType", "optionsJson", "matrixRowsJson", "matrixColumnsJson",
                "displayOrder", "updatedAt"
            )
            VALUES ($1, $2, $3, $4, $5::"QuestionType", $6::jsonb, $7::jsonb, $8::jsonb, $9, now())
            ON CONFLICT DO NOTHING
            """,
            str(uuid.uuid4()),
            version_id,
            str(q.get("questionNumber", str(order + 1))),
            str(q.get("questionText", "")),
            q_type,
            json.dumps(options) if options else None,
            json.dumps(matrix_rows) if matrix_rows else None,
            json.dumps(matrix_cols) if matrix_cols else None,
            order,
        )
        saved += 1

    logger.info(f"Successfully saved {saved} questions for version {version_id}")
    return saved
