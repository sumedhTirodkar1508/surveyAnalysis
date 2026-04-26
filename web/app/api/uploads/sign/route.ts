import { NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { createSignedUploadUrl } from "@/lib/storage";
import { z } from "zod";
import { FileAssetType } from "@prisma/client";
import { randomUUID } from "crypto";

const uploadSchema = z.object({
  kind: z.nativeEnum(FileAssetType),
  surveyId: z.string().optional(),
  batchId: z.string().optional(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().max(20 * 1024 * 1024), // 20MB limit
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // In MVP, only RESEARCHER and ADMIN can upload files (or we can use requireRole later)
    if (!["ADMIN", "RESEARCHER"].includes(user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = uploadSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
    }

    const { kind, surveyId, batchId, filename, mimeType, size } = parsed.data;

    // Build storage path
    const fileId = randomUUID();
    let storagePath = "";

    if (kind === "SURVEY_TEMPLATE") {
      if (!surveyId) return NextResponse.json({ error: "surveyId is required for SURVEY_TEMPLATE" }, { status: 400 });
      storagePath = `surveys/${surveyId}/versions/draft/template-${fileId}.pdf`; 
      // We don't have versionId until attachTemplate, so we just use draft + fileId
    } else if (kind === "RESULT_PDF") {
      if (!surveyId) return NextResponse.json({ error: "surveyId is required for RESULT_PDF" }, { status: 400 });
      storagePath = `surveys/${surveyId}/pending/${fileId}.pdf`;
    } else {
      return NextResponse.json({ error: "Upload kind not supported via client" }, { status: 400 });
    }

    const { signedUrl, path: generatedPath, token } = await createSignedUploadUrl(storagePath);

    // Create FileAsset in DB
    const fileAsset = await prisma.fileAsset.create({
      data: {
        id: fileId,
        ownerId: user.id,
        surveyId,
        batchId,
        type: kind,
        storagePath: generatedPath || storagePath,
        mimeType,
        size,
      },
    });

    return NextResponse.json({ signedUrl, fileId: fileAsset.id, token });
  } catch (err: any) {
    if (err?.code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Upload sign error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
