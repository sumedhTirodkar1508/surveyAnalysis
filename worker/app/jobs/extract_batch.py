import logging
import json
import asyncpg
import uuid
import os
import httpx
from app.main import DATABASE_URL

logger = logging.getLogger(__name__)

# Internal URL to reach the Next.js enqueue endpoint (server-to-server only).
NEXTJS_ENQUEUE_URL = os.getenv("NEXTJS_API_URL", "http://127.0.0.1:3000/api/worker/enqueue")
WORKER_SECRET = os.getenv("WORKER_CALLBACK_SECRET", "")


async def handle_extract_batch(data: dict):
    batch_id = data.get("batchId")
    if not batch_id:
        raise ValueError("Missing batchId in job data")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # ── 1. Fetch batch + version metadata ────────────────────────────
        batch_info = await conn.fetchrow("""
            SELECT b.id, b."surveyId", sv."pagesPerSubmission"
            FROM "SurveyBatch" b
            JOIN "SurveyVersion" sv ON b."surveyVersionId" = sv.id
            WHERE b.id = $1
        """, batch_id)

        if not batch_info:
            raise ValueError(f"Batch {batch_id} not found")

        pages_per_sub = batch_info["pagesPerSubmission"] or 1
        if pages_per_sub == 1:
            logger.warning(
                f"Batch {batch_id}: pagesPerSubmission=1 — every page will become its own "
                f"submission. If that is wrong, update the SurveyVersion record via "
                f"updateVersionConfig() before processing."
            )
        else:
            logger.info(f"Batch {batch_id}: {pages_per_sub} page(s) per submission")

        # ── 2. Get all PDF files in this batch ───────────────────────────
        files = await conn.fetch("""
            SELECT fa.id, fa."storagePath"
            FROM "FileAsset" fa
            JOIN "BatchFile" bf ON fa.id = bf."fileId"
            WHERE bf."batchId" = $1
            ORDER BY bf."uploadOrder" ASC
        """, batch_id)

        if not files:
            logger.warning(f"Batch {batch_id} has no files — marking FAILED")
            await conn.execute(
                'UPDATE "SurveyBatch" SET status = \'FAILED\', "errorMessage" = $2 WHERE id = $1',
                batch_id, "No files found for this batch",
            )
            return

        # ── 3. Delete any stale submissions from a previous run ──────────
        await conn.execute('DELETE FROM "SurveySubmission" WHERE "batchId" = $1', batch_id)

        from supabase import create_client
        import fitz  # PyMuPDF
        from app.main import SUPABASE_URL, SUPABASE_KEY
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

        new_submissions = []
        participant_index = 1
        total_pages_across_files = 0

        # ── 4. Slice each PDF into per-submission page ranges ─────────────
        for file_info in files:
            file_id = file_info["id"]
            storage_path = file_info["storagePath"]

            logger.info(f"Slicing PDF: {storage_path}")
            pdf_bytes = supabase_client.storage.from_("survey-files").download(storage_path)
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            total_pages = len(doc)
            doc.close()

            total_pages_across_files += total_pages

            if total_pages == 0:
                logger.warning(f"File {file_id} has 0 pages — skipping")
                continue

            complete_subs = total_pages // pages_per_sub
            remainder    = total_pages  % pages_per_sub

            if remainder > 0:
                logger.warning(
                    f"File {storage_path}: {total_pages} pages is not an exact multiple of "
                    f"{pages_per_sub}. Last {remainder} page(s) will form a partial submission."
                )

            # Full submissions
            for i in range(complete_subs):
                start = i * pages_per_sub + 1          # 1-indexed for DB
                end   = start + pages_per_sub - 1
                new_submissions.append({
                    "id": str(uuid.uuid4()),
                    "batchId": batch_id,
                    "participantIndex": participant_index,
                    "sourceFileId": file_id,
                    "sourcePageStart": start,
                    "sourcePageEnd": end,
                })
                participant_index += 1

            # Partial last submission (remainder pages)
            if remainder > 0:
                start = complete_subs * pages_per_sub + 1
                end   = total_pages
                new_submissions.append({
                    "id": str(uuid.uuid4()),
                    "batchId": batch_id,
                    "participantIndex": participant_index,
                    "sourceFileId": file_id,
                    "sourcePageStart": start,
                    "sourcePageEnd": end,
                })
                participant_index += 1

        if not new_submissions:
            logger.error(f"Batch {batch_id}: no submissions could be created from the uploaded files")
            await conn.execute(
                'UPDATE "SurveyBatch" SET status = \'FAILED\', "errorMessage" = $2 WHERE id = $1',
                batch_id, "Could not create any submissions from the uploaded files",
            )
            return

        # ── 5. Insert submissions ────────────────────────────────────────
        for sub in new_submissions:
            await conn.execute("""
                INSERT INTO "SurveySubmission"
                    (id, "batchId", "participantIndex", "sourceFileId",
                     "sourcePageStart", "sourcePageEnd", status)
                VALUES ($1, $2, $3, $4, $5, $6, 'NEEDS_REVIEW')
            """, sub["id"], sub["batchId"], sub["participantIndex"],
                sub["sourceFileId"], sub["sourcePageStart"], sub["sourcePageEnd"])

        # ── 6. Update batch counters ─────────────────────────────────────
        await conn.execute("""
            UPDATE "SurveyBatch"
            SET status = 'PROCESSING',
                "totalPages" = $2,
                "detectedSubmissionCount" = $3
            WHERE id = $1
        """, batch_id, total_pages_across_files, len(new_submissions))

        # ── 7. Delegate submission job enqueueing to Next.js ─────────────
        jobs_payload = [
            {"name": "submission.extract", "data": {"submissionId": sub["id"]}}
            for sub in new_submissions
        ]
        # Sanity-check: log every submission's page range so mis-slicing is obvious in logs.
        for sub in new_submissions:
            logger.info(
                f"  Submission {sub['participantIndex']:>3}: "
                f"pages {sub['sourcePageStart']}–{sub['sourcePageEnd']}"
            )
        logger.info(
            f"Batch {batch_id}: {total_pages_across_files} total pages → "
            f"{len(new_submissions)} submissions ({pages_per_sub} pages each). "
            f"Requesting Next.js to enqueue {len(jobs_payload)} jobs…"
        )

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                NEXTJS_ENQUEUE_URL,
                json={"jobs": jobs_payload},
                headers={"Authorization": f"Bearer {WORKER_SECRET}"},
                timeout=30.0,
            )
            resp.raise_for_status()
            logger.info(f"Enqueue response: {resp.json()}")

    except Exception as exc:
        logger.exception(f"Batch extraction failed for {batch_id}: {exc}")
        await conn.execute(
            'UPDATE "SurveyBatch" SET status = \'FAILED\', "errorMessage" = $2 WHERE id = $1',
            batch_id, str(exc),
        )
        raise
    finally:
        await conn.close()
