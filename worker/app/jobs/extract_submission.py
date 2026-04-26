"""
Main submission extraction job handler.

For each submission:
1. Download the source PDF from Supabase.
2. Render each page to an image (PDF → PNG).
3. Deskew page.
4. Find per-page translation offset vs template (phase correlation).
5. For each FieldMapping:
   - CHECKBOX/MATRIX_CHECKBOX → detect_checkbox() with template baseline +
     per-page offset.
   - TEXT_BOX/NAME_BOX → OCR.
6. Aggregate results per question → upsert SurveyResponse rows.
7. Upload cropped preview images for reviewer.
8. Update submission status.
"""
import asyncio
import io
import json
import logging
import os
import tempfile
import uuid
from typing import Any, Optional, Tuple

import asyncpg
import cv2
import fitz  # PyMuPDF
import numpy as np

from app.main import DATABASE_URL, supabase
from app.cv.deskew import deskew_image, find_page_translation
from app.cv.checkbox import extract_region_image
from app.cv.gemini_batch import extract_answers_batch_gemini

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
            s."sourcePageStart", s."sourcePageEnd",
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

    # ── 4. Download template page images ─────────────────────────────
    # Ordered by storagePath so page-000.png → index 0, page-001.png → 1, …
    template_page_rows = await conn.fetch("""
        SELECT "storagePath" FROM "FileAsset"
        WHERE "surveyId" = $1 AND type = 'PAGE_IMAGE'
        ORDER BY "storagePath"
    """, survey_id)

    template_images: dict[int, np.ndarray] = {}
    for i, row in enumerate(template_page_rows):
        try:
            tmpl_bytes = supabase.storage.from_(STORAGE_BUCKET).download(row["storagePath"])
            arr = np.frombuffer(tmpl_bytes, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None:
                template_images[i] = img
        except Exception as e:
            logger.warning(f"Could not load template page {i}: {e}")

    # ── 5. Render scan pages + compute per-page translation offsets ───
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    scan_pages: dict[int, np.ndarray] = {}
    page_offsets: dict[int, Tuple[int, int]] = {}   # relative_page → (dx_px, dy_px)

    page_start = submission["sourcePageStart"]
    page_end = submission["sourcePageEnd"]

    logger.info(f"Rendering scan pages {page_start}-{page_end} for submission {submission_id}")

    for page_idx in range(page_start, page_end + 1):
        if page_idx >= len(pdf_doc):
            break

        relative_page = page_idx - page_start

        page = pdf_doc.load_page(page_idx)
        pix = page.get_pixmap(dpi=200)
        img_arr = np.frombuffer(pix.tobytes("png"), np.uint8)
        img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)

        if img is None:
            continue

        # Deskew (minor rotation correction)
        img = deskew_image(img)

        # Per-page translation via phase correlation with template
        dx_px, dy_px = 0, 0
        tmpl = template_images.get(relative_page)
        if tmpl is not None:
            offset = find_page_translation(img, tmpl)
            if offset is not None:
                dx_px, dy_px = int(round(offset[0])), int(round(offset[1]))
                logger.info(
                    f"Page {page_idx} (P{submission['participantIndex']} rel={relative_page}): "
                    f"offset dx={dx_px} dy={dy_px}"
                )
            else:
                logger.debug(f"Page {page_idx}: translation not found, using dx=0 dy=0")

        scan_pages[relative_page] = img
        page_offsets[relative_page] = (dx_px, dy_px)

    pdf_doc.close()

    # ── 6. Extract responses via Gemini Batch ─────────────────────────
    question_mappings: dict[str, list] = {}
    for m in mappings:
        question_mappings.setdefault(m["questionId"], []).append(m)

    responses: dict[str, Any] = {}
    confidence_scores: list[float] = []

    tasks = []
    # Pass 1: Gather all crops into tasks
    for question_id, q_mappings in question_mappings.items():
        field_type = q_mappings[0]["fieldType"]
        is_checkbox = field_type in ("CHECKBOX", "MATRIX_CHECKBOX")

        for m in q_mappings:
            rel_page = m["pageNumber"]
            page_img = scan_pages.get(rel_page)
            if page_img is None:
                continue

            dx_px, dy_px = page_offsets.get(rel_page, (0, 0))
            crop = extract_region_image(
                page_img, m["x"], m["y"], m["width"], m["height"],
                dx_px=dx_px, dy_px=dy_px,
            )
            if crop.size == 0:
                continue
                
            task_id = f"{question_id}_{m['id']}"
            tasks.append({
                "id": task_id,
                "question_id": question_id,
                "mapping": m,
                "page_img": page_img,
                "dx_px": dx_px,
                "dy_px": dy_px,
                "type": "checkbox" if is_checkbox else "text",
                "crop": crop,
                "label": m.get("optionLabel", "")
            })

    # Execute batch AI extraction in 1 request
    batch_results = extract_answers_batch_gemini(tasks)
    
    # Pass 2: Reconstruct responses per question and upload previews
    for question_id, q_mappings in question_mappings.items():
        field_type = q_mappings[0]["fieldType"]
        is_checkbox = field_type in ("CHECKBOX", "MATRIX_CHECKBOX")
        
        q_tasks = [t for t in tasks if t["question_id"] == question_id]
        
        if is_checkbox:
            selected_options = []
            option_confidences = []
            for t in q_tasks:
                res = batch_results.get(t["id"])
                if not res: continue
                
                preview_path = await _upload_crop_preview(
                    t["page_img"], t["mapping"], survey_id, submission_id,
                    dx_px=t["dx_px"], dy_px=t["dy_px"],
                )
                option_confidences.append(res.get("confidence", 0.0))
                
                if res.get("checked"):
                    label = t["mapping"]["optionLabel"] or f"option_{t['mapping']['id']}"
                    selected_options.append({
                        "label": label,
                        "fill_ratio": 0.0,
                        "net_fill": 0.0,
                        "preview_path": preview_path,
                    })

            avg_conf = float(np.mean(option_confidences)) if option_confidences else 0.5
            confidence_scores.append(avg_conf)
            responses[question_id] = {
                "type": "checkbox",
                "selected": selected_options,
                "confidence": round(avg_conf, 3),
            }
        else:
            texts = []
            ocr_confidences = []
            for t in q_tasks:
                res = batch_results.get(t["id"])
                if not res: continue
                
                await _upload_crop_preview(
                    t["page_img"], t["mapping"], survey_id, submission_id,
                    dx_px=t["dx_px"], dy_px=t["dy_px"],
                )
                if res.get("text"):
                    texts.append(res["text"])
                ocr_confidences.append(res.get("confidence", 0.0))
                
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
    needs_review = overall_confidence < 0.75

    for question_id, raw_value in responses.items():
        await conn.execute("""
            INSERT INTO "SurveyResponse"
                (id, "submissionId", "questionId", "rawExtractedValueJson",
                 "confidenceScore", "needsReview")
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
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
    dx_px: int = 0,
    dy_px: int = 0,
) -> str:
    """Crop and upload a preview image for this mapping region."""
    try:
        region = extract_region_image(
            page_img, mapping["x"], mapping["y"],
            mapping["width"], mapping["height"],
            dx_px=dx_px, dy_px=dy_px,
        )
        if region.size == 0:
            return ""

        _, buf = cv2.imencode(".jpg", region, [cv2.IMWRITE_JPEG_QUALITY, 85])
        jpg_bytes = buf.tobytes()

        path = (
            f"surveys/{survey_id}/submissions/{submission_id}/"
            f"previews/mapping-{mapping['id']}.jpg"
        )
        supabase.storage.from_(STORAGE_BUCKET).upload(
            file=jpg_bytes,
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

    # Check if all submissions in batch are done; if so, set batch to NEEDS_REVIEW
    batch_done = await conn.fetchval("""
        SELECT COUNT(*) = 0
        FROM "SurveySubmission"
        WHERE "batchId" = (SELECT "batchId" FROM "SurveySubmission" WHERE id = $1)
          AND status NOT IN ('NEEDS_REVIEW', 'EXTRACTED', 'REVIEWED', 'FINALIZED')
    """, submission_id)

    if batch_done:
        await conn.execute("""
            UPDATE "SurveyBatch"
            SET status = 'NEEDS_REVIEW'
            WHERE id = (SELECT "batchId" FROM "SurveySubmission" WHERE id = $1)
              AND status = 'PROCESSING'
        """, submission_id)
        logger.info(f"All submissions done — batch set to NEEDS_REVIEW")
