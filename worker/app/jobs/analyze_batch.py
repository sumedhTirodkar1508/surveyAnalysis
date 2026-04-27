"""
Batch Analysis Job

Aggregates all verified (finalized) responses for a batch, then sends a
structured summary to Gemini 1.5 Pro to produce a detailed Community Tech
Needs Report with an executive summary and actionable support recommendations.

The finished markdown report is stored in SurveyBatch.analysisReport and the
status is flipped to "COMPLETE".  The web UI reads these fields to render the
report page and drive the "Generate Report" button state.

Job name: batch.analyze
Payload:  { "batchId": "<cuid>" }
"""
import json
import logging
import os
import time

import asyncpg
from app.main import DATABASE_URL

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Use the highest-quality reasoning model for report writing.
ANALYSIS_MODEL = "gemini-1.5-pro"


async def handle_analyze_batch(data: dict):
    batch_id = data.get("batchId")
    if not batch_id:
        raise ValueError("Missing batchId in job data")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _run_analysis(conn, batch_id)
    except Exception as exc:
        # Mark the batch analysis as failed so the UI reflects the error.
        try:
            await conn.execute(
                'UPDATE "SurveyBatch" SET "analysisStatus" = \'FAILED\' WHERE id = $1',
                batch_id,
            )
        except Exception:
            pass
        raise exc
    finally:
        await conn.close()


async def _run_analysis(conn: asyncpg.Connection, batch_id: str):
    # ── 1. Fetch batch metadata ────────────────────────────────────────────────
    batch = await conn.fetchrow(
        'SELECT id, "batchName", "surveyVersionId" FROM "SurveyBatch" WHERE id = $1',
        batch_id,
    )
    if not batch:
        raise ValueError(f"Batch {batch_id} not found")

    await conn.execute(
        'UPDATE "SurveyBatch" SET "analysisStatus" = \'PROCESSING\' WHERE id = $1',
        batch_id,
    )

    # ── 2. Fetch question schema for this version ──────────────────────────────
    questions = await conn.fetch("""
        SELECT id, "questionNumber", "questionText", "questionType",
               "optionsJson", "matrixRowsJson", "matrixColumnsJson"
        FROM   "SurveyQuestion"
        WHERE  "surveyVersionId" = $1
        ORDER  BY "displayOrder"
    """, batch["surveyVersionId"])

    question_map = {str(q["id"]): dict(q) for q in questions}

    # ── 3. Fetch all finalized responses ──────────────────────────────────────
    responses = await conn.fetch("""
        SELECT
            r."questionId",
            r."finalValueJson",
            r."correctedValueJson",
            r."rawExtractedValueJson",
            s."participantIndex",
            COALESCE(s."participantNameCorrected", s."participantNameExtracted", 'Anonymous') AS participant_name
        FROM   "SurveyResponse"  r
        JOIN   "SurveySubmission" s ON r."submissionId" = s.id
        WHERE  s."batchId" = $1
          AND  s.status    = 'FINALIZED'
        ORDER  BY s."participantIndex", r."questionId"
    """, batch_id)

    if not responses:
        logger.warning(f"Batch {batch_id} has no finalized responses — skipping analysis.")
        await conn.execute(
            'UPDATE "SurveyBatch" SET "analysisStatus" = \'FAILED\', '
            '"analysisReport" = \'No finalized responses found.\' WHERE id = $1',
            batch_id,
        )
        return

    # ── 4. Aggregate responses by question ────────────────────────────────────
    aggregated: dict[str, dict] = {}
    for row in responses:
        q_id = str(row["questionId"])
        q_meta = question_map.get(q_id, {})
        if q_id not in aggregated:
            aggregated[q_id] = {
                "questionNumber": q_meta.get("questionNumber", "?"),
                "questionText":   q_meta.get("questionText", "(unknown)"),
                "questionType":   q_meta.get("questionType", "FREE_TEXT"),
                "responses":      [],
            }

        # Pick the best available value (corrected > final > raw).
        best = row["finalValueJson"] or row["correctedValueJson"] or row["rawExtractedValueJson"]
        value = None
        if best:
            parsed = best if isinstance(best, dict) else json.loads(best)
            value = parsed.get("value")

        aggregated[q_id]["responses"].append({
            "participant": row["participant_name"],
            "index":       row["participantIndex"],
            "answer":      value,
        })

    # ── 5. Build the analytical summary payload ────────────────────────────────
    total_participants = len({r["participantIndex"] for r in responses})

    summary_lines = [
        f"BATCH: {batch['batchName']}",
        f"TOTAL PARTICIPANTS: {total_participants}",
        "",
        "═══════════════════════════════════════",
        "QUESTION-BY-QUESTION AGGREGATED DATA",
        "═══════════════════════════════════════",
    ]

    for q_id, agg in aggregated.items():
        q_type = agg["questionType"]
        summary_lines.append(
            f"\nQ{agg['questionNumber']}: {agg['questionText']}  [{q_type}]"
        )

        if q_type in ("MULTI_SELECT", "SINGLE_SELECT"):
            # Count option frequencies
            counts: dict[str, int] = {}
            for r in agg["responses"]:
                val = r["answer"]
                if isinstance(val, list):
                    for item in val:
                        counts[str(item)] = counts.get(str(item), 0) + 1
                elif val:
                    counts[str(val)] = counts.get(str(val), 0) + 1
            for option, count in sorted(counts.items(), key=lambda x: -x[1]):
                pct = round(count / total_participants * 100)
                summary_lines.append(f"  • {option}: {count}/{total_participants} ({pct}%)")

        elif q_type in ("MATRIX_SINGLE_SELECT", "MATRIX_MULTI_SELECT"):
            # Flatten matrix into row→column counts
            row_counts: dict[str, dict[str, int]] = {}
            for r in agg["responses"]:
                val = r["answer"]
                if isinstance(val, dict):
                    for row_label, col_val in val.items():
                        if row_label not in row_counts:
                            row_counts[row_label] = {}
                        cols = col_val if isinstance(col_val, list) else ([col_val] if col_val else [])
                        for col in cols:
                            row_counts[row_label][str(col)] = (
                                row_counts[row_label].get(str(col), 0) + 1
                            )
            for row_label, col_counts in row_counts.items():
                summary_lines.append(f"  {row_label}:")
                for col, cnt in sorted(col_counts.items(), key=lambda x: -x[1]):
                    pct = round(cnt / total_participants * 100)
                    summary_lines.append(f"    – {col}: {cnt} ({pct}%)")

        elif q_type in ("FREE_TEXT", "OTHER_TEXT", "NAME"):
            # List all verbatim answers
            for r in agg["responses"]:
                if r["answer"]:
                    summary_lines.append(f"  [{r['participant']}] {r['answer']}")

    data_block = "\n".join(summary_lines)

    # ── 6. Build the Gemini prompt ─────────────────────────────────────────────
    prompt = f"""You are a senior community technology needs analyst preparing a report for
a non-profit organisation's leadership team.

Below is aggregated survey data from a community technology needs assessment.
The participants are **seniors living in a residential community**.

{data_block}

═══════════════════════════════════════════════════════════════════
YOUR TASK: Write a detailed "Community Tech Needs Report" in Markdown.
═══════════════════════════════════════════════════════════════════

Structure your report with EXACTLY these sections, in this order:

# Community Technology Needs Report — {batch["batchName"]}

## 1. Executive Summary
(2–3 paragraphs. What are the most important findings? What should leadership
act on immediately? Write for a non-technical audience.)

## 2. Device & Connectivity Profile
(How are residents currently accessing technology? What devices do they own or use?)

## 3. Technology Confidence & Usage Patterns
(How confident do residents feel? What activities do they perform? Where are the gaps?)

## 4. Key Challenges & Barriers
(What specific difficulties are residents experiencing? Cite percentages where available.)

## 5. Support Preferences
(What kinds of help do residents prefer? One-on-one? Group classes? Written guides?)

## 6. Verbatim Resident Voice
(Pull the 3–5 most representative free-text responses. Quote them exactly, anonymised
as "Resident A", "Resident B", etc.)

## 7. Actionable Recommendations
(Numbered list of concrete, prioritised actions the organisation should take within
the next 90 days. Be specific — e.g. "Run weekly drop-in iPad sessions on Tuesday
afternoons" not "provide more technology training".)

## 8. Data Notes
(Any caveats about data quality, missing responses, or small sample size.)

Rules:
- Use bold for key statistics.
- Keep language plain and jargon-free.
- Do not add sections beyond those listed above.
- Return ONLY the Markdown — no preamble, no code fences.
"""

    # ── 7. Call Gemini 1.5 Pro ────────────────────────────────────────────────
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set — cannot run batch analysis.")

    client = genai.Client(api_key=api_key)

    max_retries = 3
    report_text: str | None = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=ANALYSIS_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.4,   # somewhat creative but grounded in the data
                ),
            )
            report_text = response.text.strip()
            logger.info(
                f"Batch {batch_id} analysis complete via {ANALYSIS_MODEL} "
                f"({len(report_text)} chars)"
            )
            break
        except Exception as e:
            err_str = str(e).upper()
            if any(x in err_str for x in ["429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE"]):
                wait = (attempt + 1) * 20
                if attempt < max_retries - 1:
                    logger.warning(
                        f"Gemini {ANALYSIS_MODEL} rate-limited — retrying in {wait}s "
                        f"(attempt {attempt+1}/{max_retries}). Error: {e}"
                    )
                    time.sleep(wait)
                    continue
            logger.error(f"Gemini analysis failed: {e}")
            raise

    if not report_text:
        raise RuntimeError("Gemini returned an empty report after all retries.")

    # ── 8. Persist the report ─────────────────────────────────────────────────
    await conn.execute(
        'UPDATE "SurveyBatch" '
        'SET "analysisReport" = $2, "analysisStatus" = \'COMPLETE\', "updatedAt" = now() '
        'WHERE id = $1',
        batch_id,
        report_text,
    )
    logger.info(f"Batch {batch_id} — analysis report saved.")
