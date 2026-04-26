import logging
import json
import asyncpg
import uuid
from app.main import DATABASE_URL

logger = logging.getLogger(__name__)

async def handle_extract_batch(data: dict):
    batch_id = data.get("batchId")
    if not batch_id:
        raise ValueError("Missing batchId in job data")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Get batch info — use pagesPerSubmission (user-configured pages per
        # participant) NOT pageCount (total template pages, which is unrelated
        # to how many scan pages correspond to one filled-in copy).
        batch_info = await conn.fetchrow("""
            SELECT b.id, b."surveyId", sv."pagesPerSubmission" as survey_page_count
            FROM "SurveyBatch" b
            JOIN "SurveyVersion" sv ON b."surveyVersionId" = sv.id
            WHERE b.id = $1
        """, batch_id)

        if not batch_info:
            raise ValueError(f"Batch {batch_id} not found")

        survey_id = batch_info["surveyId"]
        survey_page_count = batch_info["survey_page_count"] or 1

        # Get all file assets for this batch
        files = await conn.fetch("""
            SELECT fa.id, fa."storagePath"
            FROM "FileAsset" fa
            JOIN "BatchFile" bf ON fa.id = bf."fileId"
            WHERE bf."batchId" = $1
            ORDER BY bf."uploadOrder" ASC
        """, batch_id)

        if not files:
            logger.warning(f"Batch {batch_id} has no files")
            await conn.execute("UPDATE \"SurveyBatch\" SET status = 'NEEDS_REVIEW' WHERE id = $1", batch_id)
            return

        # ── Idempotency guard ───────────────────────────────────────────
        # If the batch already has submissions that were processed (not just
        # placeholder 'NEEDS_REVIEW' from the web app), skip re-processing.
        # This prevents duplicates when pg-boss retries the job.
        existing_count = await conn.fetchval("""
            SELECT COUNT(*) FROM "SurveySubmission"
            WHERE "batchId" = $1 AND status != 'NEEDS_REVIEW'
        """, batch_id)
        if existing_count and existing_count > 0:
            logger.info(f"Batch {batch_id} already has {existing_count} processed submissions — skipping re-processing")
            return

        # Delete placeholder submissions created by the web app (status='NEEDS_REVIEW')
        await conn.execute("DELETE FROM \"SurveySubmission\" WHERE \"batchId\" = $1 AND status = 'NEEDS_REVIEW'", batch_id)

        from supabase import create_client
        import fitz  # PyMuPDF
        from app.main import SUPABASE_URL, SUPABASE_KEY
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

        new_submissions = []
        participant_index = 1

        for file_info in files:
            file_id = file_info["id"]
            storage_path = file_info["storagePath"]

            # Download PDF metadata to check page count
            logger.info(f"Inspecting PDF {storage_path} for splitting...")
            res = supabase_client.storage.from_("survey-files").download(storage_path)
            
            doc = fitz.open(stream=res, filetype="pdf")
            total_pages = len(doc)
            doc.close()

            # Split into submissions
            # Each submission is 'survey_page_count' pages long
            num_submissions = total_pages // survey_page_count
            if num_submissions == 0 and total_pages > 0:
                num_submissions = 1 # Handle cases where PDF is shorter than template (error case usually)

            for i in range(num_submissions):
                start_page = i * survey_page_count
                end_page = min(start_page + survey_page_count - 1, total_pages - 1)
                
                sub_id = str(uuid.uuid4())
                new_submissions.append({
                    "id": sub_id,
                    "batchId": batch_id,
                    "participantIndex": participant_index,
                    "sourceFileId": file_id,
                    "sourcePageStart": start_page,
                    "sourcePageEnd": end_page
                })
                participant_index += 1

        # Insert correctly calculated submissions
        for sub in new_submissions:
            await conn.execute("""
                INSERT INTO "SurveySubmission" (id, "batchId", "participantIndex", "sourceFileId", "sourcePageStart", "sourcePageEnd", status)
                VALUES ($1, $2, $3, $4, $5, $6, 'NEEDS_REVIEW')
            """, sub["id"], sub["batchId"], sub["participantIndex"], sub["sourceFileId"], sub["sourcePageStart"], sub["sourcePageEnd"])

        # Enqueue submission.extract jobs via pg-boss
        jobs_data = []
        for sub in new_submissions:
            job_payload = json.dumps({"submissionId": sub["id"]})
            jobs_data.append(("submission.extract", job_payload))

        if jobs_data:
            # Ensure the queue exists in pgboss.queue table for v10+ compatibility
            await conn.execute("""
                INSERT INTO pgboss.queue (
                    name, policy, retry_limit, retry_delay, retry_backoff, 
                    expire_seconds, retention_seconds, deletion_seconds, partition, table_name
                )
                VALUES (
                    'submission.extract', 'standard', 2, 0, false, 
                    900, 1209600, 604800, false, 'job_common'
                )
                ON CONFLICT (name) DO NOTHING
            """)

            await conn.executemany("""
                INSERT INTO pgboss.job (name, data, state)
                VALUES ($1, $2::jsonb, 'created')
            """, jobs_data)

        logger.info(f"Enqueued {len(jobs_data)} submission.extract jobs for batch {batch_id}")
    except Exception as e:
        logger.error(f"Batch extraction failed: {e}")
        await conn.execute("""
            UPDATE "SurveyBatch" SET status = 'FAILED', "errorMessage" = $2 WHERE id = $1
        """, batch_id, str(e))
        raise
    finally:
        await conn.close()
