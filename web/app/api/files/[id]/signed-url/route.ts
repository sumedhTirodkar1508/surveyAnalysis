import { NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl } from "@/lib/storage";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    
    // params is a promise in next 15 for route handlers
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    if (!id) {
      return NextResponse.json({ error: "Missing file ID" }, { status: 400 });
    }

    const fileAsset = await prisma.fileAsset.findUnique({
      where: { id },
    });

    if (!fileAsset) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Auth check: Owner, or survey creator, or Admin
    let hasAccess = user.role === "ADMIN" || fileAsset.ownerId === user.id;

    if (!hasAccess && fileAsset.surveyId) {
      const survey = await prisma.survey.findUnique({
        where: { id: fileAsset.surveyId },
        select: { createdById: true },
      });
      if (survey?.createdById === user.id) {
        hasAccess = true;
      }
    }

    // In a real app, REVIEWERs might need access to files in batches they are assigned to,
    // and RESEARCHERs to surveys they have access to. 
    // We can simplify and grant RESEARCHER/REVIEWER general access in MVP, or strict access.
    // For MVP, we'll allow RESEARCHER and REVIEWER to access any file if they are authenticated.
    if (user.role === "RESEARCHER" || user.role === "REVIEWER") {
      hasAccess = true;
    }

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const signedUrlData = await createSignedDownloadUrl(fileAsset.storagePath, 300);

    return NextResponse.json({ signedUrl: signedUrlData.signedUrl });
  } catch (err: any) {
    if (err?.code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Download sign error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
