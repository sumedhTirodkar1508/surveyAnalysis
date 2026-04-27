"""
Full-Page Visual Extraction Job Handler.

Abandoning bounding boxes and cropping logic.
This job:
1. Downloads the source PDF.
2. Renders all 4 pages to full-page PNGs.
3. Fetches the survey question schema from the database.
4. Sends ALL pages + schema to Gemini in a SINGLE request.
5. Parsers the structured JSON response and saves SurveyAnswer records.
"""
import asyncio
import json
import logging
import os
import uuid
import time
import re
from typing import Any, List

import asyncpg
import fitz  # PyMuPDF
from app.main import DATABASE_URL, supabase

# Ensure Gemini client is available
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "survey-files")

# Three-tier model waterfall for submission extraction.
# Tried in order; each tier is skipped on 429 / 404 / 503 / daily-quota errors.
# analyze_template.py owns its own model constant and is completely unaffected.
TIER_1_MODEL = "gemini-3.1-flash-lite-preview"
TIER_2_MODEL = "gemma-4-26b-a4b-it"
TIER_3_MODEL = "gemma-4-31b-it"

MODEL_TIERS = [TIER_1_MODEL, TIER_2_MODEL, TIER_3_MODEL]

async def handle_extract_submission(data: dict):
    submission_id = data.get("submissionId")
    if not submission_id:
        raise ValueError("Missing submissionId in job data")

    # Optional: prior extraction results attached by the reprocessSubmission action.
    # Dict of { questionId: value } or None for a first-time extraction.
    previous_results: dict | None = data.get("previousResults") or None

    # Optional: list of question IDs to re-extract (smart partial reprocess).
    # When present, only those questions are sent to Gemini; all other questions
    # are left untouched in the DB (their existing responses are preserved).
    changed_question_ids: list[str] | None = data.get("changedQuestionIds") or None

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _process_submission_full_page(
            conn, submission_id, previous_results, changed_question_ids
        )
    finally:
        await conn.close()

async def _process_submission_full_page(
    conn: asyncpg.Connection,
    submission_id: str,
    previous_results: dict | None = None,
    changed_question_ids: list[str] | None = None,
):
    # 1. Fetch submission and version metadata
    submission = await conn.fetchrow("""
        SELECT
            s.id, s."batchId", s."sourceFileId", s."participantIndex",
            s."sourcePageStart", s."sourcePageEnd",
            sb."surveyVersionId", sb."surveyId"
        FROM "SurveySubmission" s
        JOIN "SurveyBatch" sb ON s."batchId" = sb.id
        WHERE s.id = $1
    """, submission_id)

    if not submission:
        raise ValueError(f"Submission {submission_id} not found")

    version_id = submission["surveyVersionId"]
    source_file_id = submission["sourceFileId"]

    # 2. Fetch Question Schema — include matrix row/column labels so the AI
    # receives the exact strings it must use as keys and values.
    questions = await conn.fetch("""
        SELECT id, "questionNumber", "questionText", "questionType",
               "optionsJson", "matrixRowsJson", "matrixColumnsJson"
        FROM "SurveyQuestion"
        WHERE "surveyVersionId" = $1
        ORDER BY "displayOrder"
    """, version_id)

    # ── Smart partial reprocess ────────────────────────────────────────────────
    # When changed_question_ids is provided (triggered by a template draft edit),
    # only send those specific questions to Gemini.  All other question responses
    # are left untouched in the DB.  This saves API calls and avoids accidentally
    # overwriting already-correct human-reviewed answers.
    if changed_question_ids:
        questions_to_extract = [q for q in questions if str(q["id"]) in changed_question_ids]
        logger.info(
            f"Partial reprocess for submission {submission_id}: "
            f"extracting {len(questions_to_extract)}/{len(questions)} questions "
            f"({changed_question_ids})"
        )
    else:
        questions_to_extract = list(questions)

    # Rename the DB "id" column to "schemaId" in the payload we send to Gemini.
    # This prevents the model from seeing a field literally called "id" and
    # echoing it back as the output key instead of the required "questionId".
    schema_rows = []
    for q in questions_to_extract:
        row = dict(q)
        row["schemaId"] = row.pop("id")   # id → schemaId
        schema_rows.append(row)
    schema_text = json.dumps(schema_rows, indent=2)

    # question_type_map still uses the raw asyncpg Record (q["id"]) — unaffected.
    # Built later, after the PDF render section.

    # 3. Download and Render PDF Pages
    source_file = await conn.fetchrow('SELECT "storagePath" FROM "FileAsset" WHERE id = $1', source_file_id)
    if not source_file:
        raise ValueError(f"FileAsset {source_file_id} not found")

    pdf_bytes = supabase.storage.from_(STORAGE_BUCKET).download(source_file["storagePath"])
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    page_start = submission["sourcePageStart"]
    page_end = submission["sourcePageEnd"]
    
    image_parts = []
    # Loop through the pages; we subtract 1 from page_idx because fitz is 0-indexed while DB is 1-indexed
    for page_idx in range(page_start, page_end + 1):
        actual_page_num = page_idx - 1
        if actual_page_num < 0 or actual_page_num >= len(pdf_doc):
            continue
            
        page = pdf_doc.load_page(actual_page_num)
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")
        image_parts.append(types.Part.from_bytes(data=img_bytes, mime_type="image/png"))
    
    pdf_doc.close()

    # 4. Build Gemini Prompt
    # Optional context block injected when this is a re-extraction requested by a human reviewer.
    context_block = ""
    if previous_results:
        context_block = f"""
════════════════════════════════════════════════════════
PREVIOUS EXTRACTION — FOR CONTEXT ONLY, NOT GROUND TRUTH
════════════════════════════════════════════════════════
A human reviewer requested a re-scan because some values may be wrong or incomplete.
Your prior extraction returned these answers (keyed by questionId):
{json.dumps(previous_results, indent=2)}

Instructions for using this context:
- Do NOT blindly copy these values — some may be incorrect.
- Use them to understand which questions you attempted before.
- Pay special attention to MULTI_SELECT questions where the previous result was only a single
  string or a 1-element array: you almost certainly missed additional marks. Re-examine every
  checkbox option in those questions with extra care.
- Perform a completely fresh, exhaustive scan as if this were your first attempt.
"""

    prompt = f"""
You are an expert data entry assistant. I am providing {len(image_parts)} pages of a filled survey.
Here is the question schema — each entry includes a "questionType" field that controls the required answer format:
{schema_text}
{context_block}

═══════════════════════════════════════════
GENERAL CONTEXT (read before extracting)
═══════════════════════════════════════════
- Participants are seniors. Expect shaky handwriting, light pencil marks, and faint ink.
- Any mark inside or through a checkbox — scribble, tick, cross, X, dot, or smear — counts as selected.
- For NAME / FREE_TEXT fields: transcribe exactly as written. Do not abbreviate, reformat, or correct spelling.

════════════════════════════════════════════════════════
EXTRACTION RULES BY questionType  (STRICTLY ENFORCED)
════════════════════════════════════════════════════════

NAME | FREE_TEXT | OTHER_TEXT
  extractedAnswer → plain string, verbatim transcription.

SINGLE_SELECT  (pick exactly one)
  extractedAnswer → single string — the label of the one selected option.

MULTI_SELECT  ("Select all that apply" / "Check all that apply")
  ==================== MANDATORY 4-STEP CHECKLIST PROTOCOL ====================

  STEP 1 -- Identify this participant's personal checkbox style FIRST.
  Before evaluating any option, scan every checkbox you have already seen on
  these pages and answer: does this person use an X? A tick? A filled box? A
  diagonal slash? A scribble? Heavy cross-hatching? Note the pattern. Then apply
  it consistently. A mark that looks like a "cancel" symbol IS their checkbox
  style -- do NOT interpret it as an erasure or a negation.

  STEP 2 -- Evaluate EVERY option one-by-one, in the order they appear.
  For each option listed in the schema, ask:
    "Is the checkbox next to [option label] marked with ANY contact from a pen or pencil?"
    -> YES -> add that option label to the selected list.
    -> NO  -> skip it.
  A mark is: ANY contact inside or on the boundary of the checkbox square:
  tick, X, slash, cross-hatch, dot, circle, scribble, heavy shade, or diagonal.
  Examine each box at MAXIMUM focus. Seniors use very light pencil, small dots,
  or faint ticks that are easy to miss at a casual glance.

  STEP 3 -- Do NOT filter or second-guess marks based on "intent".
  If the participant marked 4 boxes on a "Select all that apply" question,
  return all 4. You are a transcriber, not a judge. NEVER reduce multiple marks
  to one because "they probably only meant one".

  STEP 4 -- Self-check before finalising your answer.
  Count your YES results. If the count is 1, STOP and re-examine the entire
  question from scratch -- it is very likely you missed a faint or light mark.

  extractedAnswer -> JSON array of ALL marked option labels.
    One:  ["Try to figure it out myself"]
    Many: ["Try to figure it out myself", "Ask community staff", "Call customer support"]
  If only 1 found even after re-examination: include it AND set needsReview: true, confidence < 0.75.

MATRIX_SINGLE_SELECT | MATRIX_MULTI_SELECT
  ══════════════════════════════════════════════════════════════
  AXIS RULE — THIS IS MATHEMATICALLY ENFORCED, NEVER INVERT IT:
    JSON keys   = exact strings from "matrixRowsJson"   (the ROW labels, left column of table)
    JSON values = exact string(s) from "matrixColumnsJson" (the COLUMN labels, top row of table)
  ══════════════════════════════════════════════════════════════
  For all MATRIX questions, the JSON keys MUST be the exact strings from "matrixRowsJson". 
  The values MUST be the selected string(s) from "matrixColumnsJson". 
  NEVER invert this order. Even if you see a different pattern, follow this axis rule strictly.

  - For MATRIX_SINGLE_SELECT: each key maps to a SINGLE string (the checked column).
  - For MATRIX_MULTI_SELECT:  each key maps to an ARRAY of strings (all checked columns).
  - Every row label MUST appear as a key, even if no column is selected (use null or []).
  - NEVER swap rows and columns. NEVER use column labels as keys.

  Concrete example — suppose the schema has:
    matrixRowsJson:    ["Smart Phone", "Laptop", "Tablet"]
    matrixColumnsJson: ["Daily", "Weekly", "Occasionally", "Never"]

  Correct output:
    {{"Smart Phone": "Daily", "Laptop": "Weekly", "Tablet": "Never"}}

  WRONG (axes inverted — do NOT do this):
    {{"Daily": "Smart Phone", "Weekly": "Laptop"}}   ← keys are columns, FORBIDDEN

════════════════════════════════
CONFIDENCE & REVIEW RULES
════════════════════════════════
- confidence: float 0.0–1.0.
  STRICT: messy, ambiguous, crossed-out, or illegible marks → force confidence < 0.80.
- needsReview: true if confidence < 0.80 OR you had to guess intent.

----------------------------------------------
OUTPUT FORMAT -- each array element MUST use exactly these four keys:
----------------------------------------------
{{
  "questionId":      "<the schemaId string from the schema above>",
  "extractedAnswer": <value per questionType rules above>,
  "confidence":      <float 0.0-1.0>,
  "needsReview":     <true|false>
}}

CRITICAL: The output key MUST be "questionId", NOT "id".
          Do not rename it. The value must be the "schemaId" from the schema, verbatim.

Return ONLY a valid JSON array of these objects -- no markdown, no extra keys, no explanation.
"""

    # 5. Send to Gemini with smart retries
    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)

    results = []
    success = False

    # Walk MODEL_TIERS in order. Each tier gets exactly one attempt.
    # A tier is skipped (continue) on quota/transient errors; the loop
    # breaks early only on a clean success or a hard unrecoverable error.
    for tier_idx, model in enumerate(MODEL_TIERS):
        tier_label = f"Tier {tier_idx + 1} ({model})"
        try:
            response = client.models.generate_content(
                model=model,
                contents=image_parts + [prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
            )
            results = json.loads(response.text.strip())
            logger.info(f"Gemini extraction succeeded on {tier_label}:")
            logger.info(json.dumps(results, indent=2))
            success = True
            break

        except Exception as e:
            err_str = str(e).upper()
            has_next = tier_idx < len(MODEL_TIERS) - 1

            # ── Hard daily quota: skip this model, try the next tier ──────
            # Gemini surfaces this as RESOURCE_EXHAUSTED + "GenerateRequestsPerDay"
            # or a human-readable "limit: 20 requests per day" message.
            if "GENERATEREQUESTSPERDAY" in err_str or "LIMIT: 20" in err_str:
                if has_next:
                    logger.warning(
                        f"{tier_label} daily quota exhausted — skipping to next tier. Error: {e}"
                    )
                    continue  # → try next tier immediately
                logger.critical(
                    f"All model tiers have exhausted their daily quota. "
                    f"Wait until midnight PT. Last error: {e}"
                )
                break  # → mark failed below

            # ── Transient errors (429 RPM, 503 unavailable) ──────────────
            # Brief pause before falling over to the next tier gives the Tier-1
            # model a chance to recover from a momentary rate-limit spike.
            # 404 / NOT_FOUND is a hard model-not-available signal — no sleep needed.
            is_rate_or_unavailable = any(
                x in err_str for x in ["429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE"]
            )
            is_not_found = any(x in err_str for x in ["404", "NOT_FOUND"])

            if is_rate_or_unavailable or is_not_found:
                if has_next:
                    next_label = f"Tier {tier_idx + 2} ({MODEL_TIERS[tier_idx + 1]})"
                    if is_rate_or_unavailable:
                        logger.warning(
                            f"{tier_label} rate-limited/unavailable — waiting 3 s before "
                            f"switching to {next_label}. Error: {e}"
                        )
                        time.sleep(3)   # ← Patience Patch: let Tier-1 breathe
                    else:
                        logger.warning(
                            f"{tier_label} model not found — switching to {next_label}. "
                            f"Error: {e}"
                        )
                    continue  # → try next tier
                logger.error(
                    f"All tiers failed. Last error on {tier_label}: {e}"
                )
                break  # → mark failed below

            # ── Any other error: fail immediately (no tier cycling) ────────
            logger.error(
                f"Gemini extraction failed with unexpected error on {tier_label}: {e}"
            )
            break  # → mark failed below

    if not success:
        await _mark_submission_failed(conn, submission_id)
        return

    # 6. Save Answers
    # Build a lookup of questionId → questionType so we can identify the NAME field.
    question_type_map = {str(q["id"]): q["questionType"] for q in questions}

    confidences = []
    participant_name: str | None = None

    for res in results:
        # Fix 1: resilient key lookup — Gemini sometimes returns "id" instead of
        # the requested "questionId" because it mirrors the schema field name.
        q_id = res.get("questionId") or res.get("id")

        # Fix 2: validation guard — skip malformed rows rather than hitting the
        # NOT NULL constraint on SurveyResponse."questionId".
        if not q_id:
            logger.warning(f"Skipping result row with no questionId/id: {res}")
            continue

        answer = res.get("extractedAnswer")
        conf = float(res.get("confidence", 0.5))
        review = bool(res.get("needsReview", False))

        # ── Post-processing: enforce type contracts & catch likely misses ──────
        q_type = question_type_map.get(str(q_id))

        if q_type == "MULTI_SELECT":
            if isinstance(answer, str):
                # AI returned a bare string for a "select all that apply" question.
                # This almost certainly means it stopped at the first mark it saw.
                logger.warning(
                    f"MULTI_SELECT Q {q_id} got a single string {answer!r}; "
                    f"coercing to list, capping confidence at 0.70, forcing review."
                )
                answer = [answer] if answer.strip() else []
                review = True
                conf = min(conf, 0.70)
            elif isinstance(answer, list) and len(answer) == 1:
                # One selection on a multi-select is *plausible* but suspicious —
                # seniors often mark multiple boxes lightly, so flag it.
                logger.info(
                    f"MULTI_SELECT Q {q_id} has only 1 selection: {answer}; "
                    f"capping confidence at 0.75, flagging review."
                )
                review = True
                conf = min(conf, 0.75)

        confidences.append(conf)

        # Capture the identity from the NAME-typed question.
        if q_type == "NAME" and answer:
            participant_name = str(answer).strip() or None

        await conn.execute("""
            INSERT INTO "SurveyResponse"
                (id, "submissionId", "questionId", "rawExtractedValueJson", "confidenceScore", "needsReview")
            VALUES ($1, $2, $3, $4::jsonb, $5, $6)
            ON CONFLICT ("submissionId", "questionId")
            DO UPDATE SET
                "rawExtractedValueJson" = EXCLUDED."rawExtractedValueJson",
                "confidenceScore" = EXCLUDED."confidenceScore",
                "needsReview" = EXCLUDED."needsReview"
        """, str(uuid.uuid4()), submission_id, q_id, json.dumps({"value": answer}), conf, review)

    # 7. Persist participant identity directly on the submission row.
    # For partial reprocess: only update participantNameExtracted if the NAME
    # question was among the changed ones (or if this is a full reprocess).
    name_was_extracted = participant_name is not None
    if not changed_question_ids or name_was_extracted:
        # Full reprocess OR partial reprocess that included the NAME field
        identity = participant_name if participant_name else "Anonymous"
        await conn.execute(
            'UPDATE "SurveySubmission" SET "participantNameExtracted" = $1 WHERE id = $2',
            identity, submission_id,
        )
        logger.info(f"Submission {submission_id} identity updated: {identity!r}")
    else:
        logger.info(
            f"Submission {submission_id}: NAME question not in changed set — "
            "keeping existing participantNameExtracted."
        )

    # For partial reprocess: blend our new confidences with the existing scores
    # for the untouched questions so the overall_conf reflects all responses.
    if changed_question_ids:
        unchanged_rows = await conn.fetch("""
            SELECT "confidenceScore"
            FROM "SurveyResponse"
            WHERE "submissionId" = $1
              AND "questionId" != ALL($2::text[])
              AND "confidenceScore" IS NOT NULL
        """, submission_id, changed_question_ids)
        all_confidences = confidences + [float(r["confidenceScore"]) for r in unchanged_rows]
    else:
        all_confidences = confidences

    overall_conf = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0
    await _mark_submission_complete(conn, submission_id, overall_conf)
    logger.info(f"Submission {submission_id} extracted via full-page vision. Conf: {overall_conf:.2f}")

async def _mark_submission_complete(conn: asyncpg.Connection, submission_id: str, confidence: float):
    status = "NEEDS_REVIEW" if confidence < 0.80 else "EXTRACTED"
    await conn.execute(
        'UPDATE "SurveySubmission" SET status = $2, "confidenceScore" = $3 WHERE id = $1',
        submission_id, status, confidence,
    )
    await _check_batch_complete(conn, submission_id)


async def _mark_submission_failed(conn: asyncpg.Connection, submission_id: str):
    # 'FAILED' is not a valid SubmissionStatus enum value; keep as NEEDS_REVIEW
    # so a human reviewer sees it. Set confidence=0 so the batch-completion
    # check (confidenceScore IS NULL means "not yet processed") still fires.
    await conn.execute(
        'UPDATE "SurveySubmission" SET status = \'NEEDS_REVIEW\', "confidenceScore" = $2 WHERE id = $1',
        submission_id, 0.0,
    )
    await _check_batch_complete(conn, submission_id)


async def _check_batch_complete(conn: asyncpg.Connection, submission_id: str):
    """Set the batch to NEEDS_REVIEW once every submission has been processed.

    We use ``confidenceScore IS NULL`` as the sentinel for "not yet extracted"
    because ``SubmissionStatus`` has no PROCESSING/PENDING value — submissions
    are created as NEEDS_REVIEW and stay that way until the worker sets a score.
    """
    batch_id = await conn.fetchval(
        'SELECT "batchId" FROM "SurveySubmission" WHERE id = $1', submission_id
    )
    if batch_id is None:
        return

    unprocessed = await conn.fetchval(
        'SELECT COUNT(*) FROM "SurveySubmission" WHERE "batchId" = $1 AND "confidenceScore" IS NULL',
        batch_id,
    )
    if unprocessed == 0:
        await conn.execute(
            'UPDATE "SurveyBatch" SET status = \'NEEDS_REVIEW\' WHERE id = $1 AND status = \'PROCESSING\'',
            batch_id,
        )
        logger.info(f"All submissions done — batch {batch_id} → NEEDS_REVIEW")
