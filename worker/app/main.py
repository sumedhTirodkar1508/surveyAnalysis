import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
import asyncpg
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Config
DATABASE_URL = os.getenv("PG_CONNECTION_STRING", os.getenv("DIRECT_URL"))
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

supabase: Client | None = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Job Registry
from app.jobs.render_template import handle_render_template
from app.jobs.extract_batch import handle_extract_batch
from app.jobs.extract_submission import handle_extract_submission

JOB_HANDLERS = {
    "template.render": handle_render_template,
    "batch.extract": handle_extract_batch,
    "submission.extract": handle_extract_submission,
}

# Poll loop
async def poll_pgboss(pool: asyncpg.Pool):
    logger.info("Starting pg-boss poller...")
    while True:
        try:
            async with pool.acquire() as conn:
                # Fetch one job
                # NOTE: pg-boss schema is usually `pgboss.job`
                # If pg-boss isn't initialized yet, this might fail, so we catch errors.
                job = await conn.fetchrow("""
                    SELECT id, name, data 
                    FROM pgboss.job 
                    WHERE state = 'created' 
                    ORDER BY priority DESC, created_on ASC 
                    FOR UPDATE SKIP LOCKED 
                    LIMIT 1
                """)
                
                if job:
                    job_id, name, data = job["id"], job["name"], job["data"]
                    logger.info(f"Picked up job {job_id} ({name})")
                    
                    # Mark as active
                    await conn.execute("UPDATE pgboss.job SET state = 'active', started_on = now() WHERE id = $1", job_id)
                    
                    try:
                        handler = JOB_HANDLERS.get(name)
                        if handler:
                            await handler(data)
                            await conn.execute("UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE id = $1", job_id)
                            logger.info(f"Job {job_id} completed.")
                        else:
                            raise ValueError(f"No handler for job name: {name}")
                    except Exception as e:
                        logger.error(f"Job {job_id} failed: {e}")
                        await conn.execute(
                            "UPDATE pgboss.job SET state = 'failed', completed_on = now(), output = $2 WHERE id = $1", 
                            job_id, 
                            str(e)
                        )
                else:
                    await asyncio.sleep(2)
        except Exception as e:
            logger.error(f"Poller error: {e}")
            await asyncio.sleep(5)

@asynccontextmanager
async def lifespan(app: FastAPI):
    if not DATABASE_URL:
        logger.warning("PG_CONNECTION_STRING is missing. Poller will not start.")
        yield
        return
        
    pool = await asyncpg.create_pool(DATABASE_URL)
    app.state.pool = pool
    
    task = asyncio.create_task(poll_pgboss(pool))
    yield
    task.cancel()
    await pool.close()

app = FastAPI(lifespan=lifespan)

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
