import logging
import asyncpg
from app.main import DATABASE_URL

logger = logging.getLogger(__name__)

async def handle_extract_batch(data: dict):
    batch_id = data.get("batchId")
    if not batch_id:
        raise ValueError("Missing batchId in job data")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Get all submissions for this batch
        submissions = await conn.fetch("""
            SELECT id FROM "SurveySubmission"
            WHERE "batchId" = $1
        """, batch_id)

        if not submissions:
            logger.warning(f"Batch {batch_id} has no submissions")
            return

        # Enqueue submission.extract jobs via pg-boss
        # We can insert directly into pgboss.job
        # Or better, we can use an actual pg-boss client, but inserting directly is fine for this worker.
        # Format for pgboss.job data is JSONB.
        import json
        
        jobs_data = []
        for sub in submissions:
            job_payload = json.dumps({"submissionId": sub["id"]})
            jobs_data.append(("submission.extract", job_payload))

        if jobs_data:
            # We use executemany to insert jobs
            # pg-boss schema defaults to pgboss.job
            await conn.executemany("""
                INSERT INTO pgboss.job (name, data, state)
                VALUES ($1, $2::jsonb, 'created')
            """, jobs_data)
        
        logger.info(f"Enqueued {len(jobs_data)} submission.extract jobs for batch {batch_id}")
    finally:
        await conn.close()
