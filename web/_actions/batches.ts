"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { revalidatePath } from "next/cache";

export async function createBatch(surveyId: string, name: string, fileIds: string[]) {
  const user = await requireRole(["ADMIN", "RESEARCHER"]);

  // Ensure survey exists and has an active version
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: { versions: { where: { isActive: true } } }
  });

  if (!survey) throw new Error("Survey not found");
  if (survey.versions.length === 0) throw new Error("No active survey version found. Please activate a version first.");

  const activeVersion = survey.versions[0];

  // Create the batch
  const batch = await prisma.surveyBatch.create({
    data: {
      surveyId,
      surveyVersionId: activeVersion.id,
      uploadedById: user.id,
      batchName: name,
      status: "PROCESSING",
    }
  });

  // Attach all uploaded files to the batch and create BatchFile records
  await prisma.fileAsset.updateMany({
    where: { id: { in: fileIds } },
    data: { batchId: batch.id }
  });

  await prisma.batchFile.createMany({
    data: fileIds.map((fileId, idx) => ({
      batchId: batch.id,
      fileId,
      uploadOrder: idx,
    }))
  });

  // Create one SurveySubmission per uploaded file
  // participantIndex is 1-based; sourcePageStart/End will be updated by the worker
  await prisma.surveySubmission.createMany({
    data: fileIds.map((fileId, idx) => ({
      batchId: batch.id,
      participantIndex: idx + 1,
      sourceFileId: fileId,
      sourcePageStart: 0,
      sourcePageEnd: 0,
      // status defaults to NEEDS_REVIEW per schema
    }))
  });

  // Create an ExtractionJob record for tracking
  await prisma.extractionJob.create({
    data: {
      batchId: batch.id,
      status: "QUEUED",
    }
  });

  // Enqueue extraction job
  const { enqueueJob } = await import("@/lib/queue");
  await enqueueJob("batch.extract", { batchId: batch.id });

  revalidatePath(`/surveys/${surveyId}`);
  return batch;
}

export async function getBatch(batchId: string) {
  await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  return prisma.surveyBatch.findUnique({
    where: { id: batchId },
    include: {
      survey: true,
      surveyVersion: true,
      submissions: {
        orderBy: { participantIndex: "asc" },
        take: 50,
      },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { submissions: true } }
    }
  });
}
