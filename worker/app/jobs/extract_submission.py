"""
Main submission extraction job handler.

For each submission:
1. Download the source PDF from Supabase.
2. Render each page to an image (PDF → PNG).
3. Deskew and optionally align to the template page.
4. For each FieldMapping:
   - CHECKBOX/MATRIX_CHECKBOX → run checkbox detector.
   - TEXT_BOX/NAME_BOX → run OCR.
5. Aggregate results per question → upsert SurveyResponse rows.
6. Upload cropped preview images for reviewer.
7. Update submission status.
"""
import asyncio
import io
import json
import logging
import os
import tempfile
import uuid
from typing import Any

import asyncpg
import cv2
import fitz  # PyMuPDF
import numpy as np

from app.main import DATABASE_URL, supabase
from app.cv.deskew import deskew_image, align_to_template
from app.cv.checkbox import detect_checkbox, extract_region_image
from app.ocr.provider import get_ocr_provider

logger = logging.getLogger(__name__)

STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "survey-files")


async def handle_extract_submission(data: dict):
    submission_id = data.get("submissionId")
    if not submission_id:
        raise ValueError("Missing submissionId in job data")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _process_submission(conn, submission_id)
    finally:
        await conn.close()


async def _process_submission(conn: asyncpg.Connection, submission_id: str):
    # ── 1. Fetch submission + related data ─────────────────────────────
    submission = await conn.fetchrow("""
        SELECT
            s.id, s."batchId", s."sourceFileId", s."participantIndex",
            sb."surveyVersionId", sb."surveyId",
            sv."templateFileId", sv."pageCount"
        FROM "SurveySubmission" s
        JOIN "SurveyBatch" sb ON s."batchId" = sb.id
        JOIN "SurveyVersion" sv ON sb."surveyVersionId" = sv.id
        WHERE s.id = $1
    """, submission_id)

    if not submission:
        raise ValueError(f"Submission {submission_id} not found")

    version_id = submission["surveyVersionId"]
    survey_id = submission["surveyId"]
    source_file_id = submission["sourceFileId"]

    # ── 2. Load field mappings ────────────────────────────────────────
    mappings = await conn.fetch("""
        SELECT fm.id, fm."questionId", fm."fieldType",
               fm."pageNumber", fm.x, fm.y, fm.width, fm.height, fm."optionLabel"
        FROM "FieldMapping" fm
        JOIN "SurveyQuestion" sq ON fm."questionId" = sq.id
        WHERE sq."surveyVersionId" = $1
        ORDER BY fm."pageNumber", fm.id
    """, version_id)

    if not mappings:
        logger.warning(f"No field mappings for version {version_id}")
        await _mark_submission_complete(conn, submission_id, {}, 1.0)
        return

    # ── 3. Download source PDF ────────────────────────────────────────
    source_file = await conn.fetchrow(
        'SELECT "storagePath" FROM "FileAsset" WHERE id = $1', source_file_id
    )
    if not source_file:
        raise ValueError(f"FileAsset {source_file_id} not found")

    pdf_bytes = supabase.storage.from_(STORAGE_BUCKET).download(source_file["storagePath"])

    # ── 4. Download template pages (cached from render step) ─────────
    template_pages = await conn.fetch("""
        SELECT "storagePath" FROM "FileAsset"
        WHERE "surveyId" = $1 AND type = 'PAGE_IMAGE'
        ORDER BY "storagePath"
    """, survey_id)

    template_images: dict[int, np.ndarray] = {}
    for i, tp in enumerate(template_pages):
        try:
            tmpl_bytes = supabase.storage.from_(STORAGE_BUCKET).download(tp["storagePath"])
            arr = np.frombuffer(tmpl_bytes, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            template_images[i] = img
        except Exception as e:
            logger.warning(f"Could not load template page {i}: {e}")

    # ── 5. Render scan pages to images ───────────────────────────────
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    scan_pages: dict[int, np.ndarray] = {}
    for page_num in range(len(pdf_doc)):
        page = pdf_doc.load_page(page_num)
        pix = page.get_pixmap(dpi=200)
        img_arr = np.frombuffer(pix.tobytes("png"), np.uint8)
        img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        if img is not None:
            # Deskew
            img = deskew_image(img)
            # Align to template if available
            tmpl = template_images.get(page_num)
            if tmpl is not None:
                aligned = align_to_template(img, tmpl)
                if aligned is not None:
                    img = aligned
        scan_pages[page_num] = img

    # ── 6. Extract responses ─────────────────────────────────────────
    ocr = get_ocr_provider()
    # Group mappings by question
    question_mappings: dict[str, list] = {}
    for m in mappings:
        qid = m["questionId"]
        question_mappings.setdefault(qid, []).append(m)

    responses: dict[str, Any] = {}  # questionId → extracted value
    confidence_scores: list[float] = []

    for question_id, q_mappings in question_mappings.items():
        field_type = q_mappings[0]["fieldType"]

        if field_type in ("CHECKBOX", "MATRIX_CHECKBOX"):
            # Each mapping represents one selectable option
            selected_options = []
            option_confidences = []

            for m in q_mappings:
                page_img = scan_pages.get(m["pageNumber"])
                if page_img is None:
                    continue

                result = detect_checkbox(page_img, m["x"], m["y"], m["width"], m["height"])
                option_confidences.append(result.confidence)

                # Upload cropped preview
                preview_path = await _upload_crop_preview(
                    page_img, m, survey_id, submission_id
                )

                if result.checked:
                    label = m["optionLabel"] or f"option_{m['id']}"
                    selected_options.append({
                        "label": label,
                        "fill_ratio": result.fill_ratio,
                        "preview_path": preview_path,
                    })

            avg_conf = float(np.mean(option_confidences)) if option_confidences else 0.5
            confidence_scores.append(avg_conf)
            responses[question_id] = {
                "type": "checkbox",
                "selected": selected_options,
                "confidence": round(avg_conf, 3),
            }

        elif field_type in ("TEXT_BOX", "NAME_BOX"):
            texts = []
            ocr_confidences = []

            for m in q_mappings:
                page_img = scan_pages.get(m["pageNumber"])
                if page_img is None:
                    continue

                region = extract_region_image(page_img, m["x"], m["y"], m["width"], m["height"])
                if region.size == 0:
                    continue

                text, conf = ocr.recognize(region)
                texts.append(text)
                ocr_confidences.append(conf)

                await _upload_crop_preview(page_img, m, survey_id, submission_id)

            combined_text = " ".join(t for t in texts if t).strip()
            avg_conf = float(np.mean(ocr_confidences)) if ocr_confidences else 0.0
            confidence_scores.append(avg_conf)
            responses[question_id] = {
                "type": "text",
                "value": combined_text,
                "confidence": round(avg_conf, 3),
            }

    # ── 7. Upsert SurveyResponse rows ────────────────────────────────
    overall_confidence = float(np.mean(confidence_scores)) if confidence_scores else 0.5

    # Determine if it needs human review (confidence below threshold)
    needs_review = overall_confidence < 0.75

    for question_id, raw_value in responses.items():
        await conn.execute("""
            INSERT INTO "SurveyResponse"
                (id, "submissionId", "questionId", "rawExtractedValueJson", "confidenceScore", "needsReview")
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT ("submissionId", "questionId")
            DO UPDATE SET
                "rawExtractedValueJson" = EXCLUDED."rawExtractedValueJson",
                "confidenceScore" = EXCLUDED."confidenceScore",
                "needsReview" = EXCLUDED."needsReview"
        """,
            str(uuid.uuid4()),
            submission_id,
            question_id,
            json.dumps(raw_value),
            raw_value.get("confidence", 0.5),
            needs_review,
        )

    await _mark_submission_complete(conn, submission_id, responses, overall_confidence)
    logger.info(f"Submission {submission_id} extracted. Confidence: {overall_confidence:.2f}")


async def _upload_crop_preview(
    page_img: np.ndarray,
    mapping: asyncpg.Record,
    survey_id: str,
    submission_id: str,
) -> str:
    """Crop and upload a preview image for this mapping region. Returns storage path."""
    try:
        region = extract_region_image(
            page_img, mapping["x"], mapping["y"], mapping["width"], mapping["height"]
        )
        if region.size == 0:
            return ""

        _, buf = cv2.imencode(".jpg", region, [cv2.IMWRITE_JPEG_QUALITY, 85])
        png_bytes = buf.tobytes()

        path = f"surveys/{survey_id}/submissions/{submission_id}/previews/mapping-{mapping['id']}.jpg"
        supabase.storage.from_(STORAGE_BUCKET).upload(
            file=png_bytes,
            path=path,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return path
    except Exception as e:
        logger.warning(f"Could not upload crop preview for mapping {mapping['id']}: {e}")
        return ""


async def _mark_submission_complete(
    conn: asyncpg.Connection,
    submission_id: str,
    responses: dict,
    confidence: float,
):
    new_status = "NEEDS_REVIEW" if confidence < 0.75 else "EXTRACTED"
    await conn.execute("""
        UPDATE "SurveySubmission"
        SET status = $2, "confidenceScore" = $3
        WHERE id = $1
    """, submission_id, new_status, confidence)
