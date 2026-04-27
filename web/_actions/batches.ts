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

/** Lightweight poll-safe status check — only reads one column. */
export async function getBatchStatus(batchId: string): Promise<string> {
  await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);
  const row = await prisma.surveyBatch.findUnique({
    where: { id: batchId },
    select: { status: true },
  });
  return row?.status ?? "FAILED";
}

/**
 * Extended poll check used by BatchPoller.
 * Returns both the batch status and how many submissions are still being
 * processed (confidenceScore IS NULL — the worker's "not yet extracted" sentinel).
 * A non-zero pendingCount means a reprocess job is in flight even when the
 * batch status itself hasn't changed from NEEDS_REVIEW.
 */
export async function getBatchProcessingState(batchId: string): Promise<{
  status: string;
  pendingCount: number;
}> {
  await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);
  const [batch, pendingCount] = await Promise.all([
    prisma.surveyBatch.findUnique({
      where: { id: batchId },
      select: { surveyId: true, status: true },
    }),
    prisma.surveySubmission.count({
      where: { batchId, confidenceScore: null },
    }),
  ]);

  if (batch) {
    revalidatePath(`/surveys/${batch.surveyId}/batches/${batchId}`);
  }

  return { status: batch?.status ?? "FAILED", pendingCount };
}

/**
 * Enqueues a batch.analyze job for the given batch.
 * Immediately flips analysisStatus to "QUEUED" so the UI reflects the
 * pending state before the worker picks the job up.
 */
export async function triggerBatchAnalysis(batchId: string): Promise<void> {
  await requireRole(["ADMIN", "RESEARCHER"]);

  // Verify the batch exists and is in a finalized state.
  const batch = await prisma.surveyBatch.findUnique({
    where: { id: batchId },
    select: { id: true, surveyId: true, status: true, analysisStatus: true },
  });
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "FINALIZED")
    throw new Error("Batch must be FINALIZED before running analysis");

  // Mark as queued immediately so the button disables.
  await prisma.surveyBatch.update({
    where: { id: batchId },
    data: { analysisStatus: "QUEUED" },
  });

  const { enqueueJob } = await import("@/lib/queue");
  await enqueueJob("batch.analyze", { batchId });

  revalidatePath(`/surveys/${batch.surveyId}/batches/${batchId}`);
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
