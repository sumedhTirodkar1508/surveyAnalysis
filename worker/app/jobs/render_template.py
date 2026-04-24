import logging
import uuid
import tempfile
import fitz # PyMuPDF
from app.main import supabase
from fastapi import Request

logger = logging.getLogger(__name__)

async def handle_render_template(data: dict):
    version_id = data.get("versionId")
    if not version_id:
        raise ValueError("Missing versionId in job data")

    # We need to import the asyncpg pool. We'll pass it around or access globally.
    # To keep it clean, we'll fetch it from the running app's state if possible.
    # Alternatively, we can just connect here or get it from `app.main` but that's messy.
    # Let's import the `DATABASE_URL` and create a connection here, or pass `conn` from poller.
    
    # Since we can't easily inject the connection without changing the handler signature, 
    # let's just create a one-off connection for now.
    import asyncpg
    from app.main import DATABASE_URL
    
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Get SurveyVersion
        version = await conn.fetchrow("""
            SELECT "surveyId", "templateFileId", "versionNumber" 
            FROM "SurveyVersion" 
            WHERE id = $1
        """, version_id)
        
        if not version:
            raise ValueError(f"SurveyVersion {version_id} not found")
            
        survey_id = version["surveyId"]
        template_file_id = version["templateFileId"]
        version_number = version["versionNumber"]
        
        if not template_file_id:
            raise ValueError(f"SurveyVersion {version_id} has no templateFileId")

        # Get FileAsset for template
        file_asset = await conn.fetchrow("""
            SELECT "storagePath", "ownerId" 
            FROM "FileAsset" 
            WHERE id = $1
        """, template_file_id)
        
        if not file_asset:
            raise ValueError(f"Template FileAsset {template_file_id} not found")
            
        storage_path = file_asset["storagePath"]
        owner_id = file_asset["ownerId"]

        # Download from Supabase
        logger.info(f"Downloading {storage_path} from Supabase")
        res = supabase.storage.from_("survey-files").download(storage_path)
        
        # Write to temp file
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
            tf.write(res)
            tf_path = tf.name

        try:
            # Render pages to PNG
            doc = fitz.open(tf_path)
            page_count = len(doc)
            
            # Update page count in DB (in case it differs from client)
            await conn.execute("""
                UPDATE "SurveyVersion" 
                SET "pageCount" = $1 
                WHERE id = $2
            """, page_count, version_id)

            for i in range(page_count):
                page = doc.load_page(i)
                # Render at 200 DPI
                pix = page.get_pixmap(dpi=200)
                png_bytes = pix.tobytes("png")
                
                # Upload PNG
                # Path: surveys/{surveyId}/versions/{versionId}/template-pages/page-{n:03}.png
                img_path = f"surveys/{survey_id}/versions/{version_id}/template-pages/page-{i:03d}.png"
                
                supabase.storage.from_("survey-files").upload(
                    file=png_bytes,
                    path=img_path,
                    file_options={"content-type": "image/png"}
                )
                
                # Create FileAsset row for this page image
                await conn.execute("""
                    INSERT INTO "FileAsset" (id, "ownerId", "surveyId", "type", "storagePath", "mimeType", "size", "createdAt")
                    VALUES ($1, $2, $3, 'PAGE_IMAGE', $4, 'image/png', $5, now())
                    ON CONFLICT ("storagePath") DO UPDATE SET size = EXCLUDED.size
                """, str(uuid.uuid4()), owner_id, survey_id, img_path, len(png_bytes))
                
                logger.info(f"Rendered and uploaded page {i+1}/{page_count}")
        finally:
            import os
            os.remove(tf_path)

        logger.info(f"Successfully processed template for version {version_id}")
    finally:
        await conn.close()
