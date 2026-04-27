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

export async function createDraftVersion(
  surveyId: string,
  pagesPerSubmission: number = 1,
) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  if (pagesPerSubmission < 1 || !Number.isInteger(pagesPerSubmission)) {
    throw new Error("pagesPerSubmission must be a positive integer.");
  }

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
      pagesPerSubmission,
    }
  });

  revalidatePath(`/surveys/${surveyId}`);
  return version;
}

/**
 * Update mutable config on a draft version.
 * Call this from the template page to set pagesPerSubmission before activating.
 * Blocked once the version is active to prevent silently breaking in-flight batches.
 */
export async function updateVersionConfig(
  versionId: string,
  config: { pagesPerSubmission?: number },
) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const version = await prisma.surveyVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error("Version not found.");
  if (version.isActive) {
    throw new Error(
      "Cannot change pagesPerSubmission on an active version — doing so would break in-flight batches. " +
      "Create a new draft version instead."
    );
  }

  if (
    config.pagesPerSubmission !== undefined &&
    (config.pagesPerSubmission < 1 || !Number.isInteger(config.pagesPerSubmission))
  ) {
    throw new Error("pagesPerSubmission must be a positive integer.");
  }

  const updated = await prisma.surveyVersion.update({
    where: { id: versionId },
    data: {
      ...(config.pagesPerSubmission !== undefined && {
        pagesPerSubmission: config.pagesPerSubmission,
      }),
    },
  });

  revalidatePath(`/surveys/${version.surveyId}`);
  revalidatePath(`/surveys/${version.surveyId}/template`);
  return updated;
}

export async function activateVersion(versionId: string) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const version = await prisma.surveyVersion.findUnique({
    where: { id: versionId },
    include: { questions: true }
  });

  if (!version) throw new Error("Not found");
  if (version.questions.length === 0) {
    throw new Error("Cannot activate a version with no questions.");
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

export async function deactivateVersion(versionId: string) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const version = await prisma.surveyVersion.findUnique({
    where: { id: versionId },
  });

  if (!version) throw new Error("Not found");

  const updated = await prisma.surveyVersion.update({
    where: { id: versionId },
    data: { isActive: false }
  });

  revalidatePath(`/surveys/${version.surveyId}`);
  return updated;
}
