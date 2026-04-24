"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { revalidatePath } from "next/cache";

export async function attachTemplate(versionId: string, fileAssetId: string, pageCount: number) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const version = await prisma.surveyVersion.update({
    where: { id: versionId },
    data: {
      templateFileId: fileAssetId,
      pageCount,
    },
    include: { survey: true }
  });

  // Enqueue job to render template pages to PNGs
  const { enqueueJob } = await import("@/lib/queue");
  await enqueueJob("template.render", { versionId });

  revalidatePath(`/surveys/${version.surveyId}`);
  revalidatePath(`/surveys/${version.surveyId}/template`);
  return version;
}

export async function createDraftVersion(surveyId: string) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  // Find latest version to determine new version number
  const versions = await prisma.surveyVersion.findMany({
    where: { surveyId },
    orderBy: { versionNumber: "desc" },
    take: 1
  });

  const nextVersion = (versions[0]?.versionNumber || 0) + 1;

  const version = await prisma.surveyVersion.create({
    data: {
      surveyId,
      versionNumber: nextVersion,
      pageCount: 0,
      isActive: false,
    }
  });

  revalidatePath(`/surveys/${surveyId}`);
  return version;
}

export async function activateVersion(versionId: string) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const version = await prisma.surveyVersion.findUnique({
    where: { id: versionId },
    include: { questions: { include: { fieldMappings: true } } }
  });

  if (!version) throw new Error("Not found");

  // Validate that every question has >= 1 mapping
  for (const q of version.questions) {
    if (q.fieldMappings.length === 0) {
      throw new Error(`Question ${q.questionNumber} has no mappings.`);
    }
  }

  // Unset prior active
  await prisma.surveyVersion.updateMany({
    where: { surveyId: version.surveyId, isActive: true },
    data: { isActive: false }
  });

  // Set new active
  await prisma.surveyVersion.update({
    where: { id: versionId },
    data: { isActive: true }
  });

  revalidatePath(`/surveys/${version.surveyId}`);
  return version;
}
