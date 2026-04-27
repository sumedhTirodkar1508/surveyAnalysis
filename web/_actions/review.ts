"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";

export async function saveResponseCorrection(
  responseId: string,
  correctedValueJson: any
) {
  const user = await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  const response = await prisma.surveyResponse.findUnique({
    where: { id: responseId },
    include: { submission: { include: { batch: true } } },
  });

  if (!response) throw new Error("Response not found");

  await prisma.surveyResponse.update({
    where: { id: responseId },
    data: {
      correctedValueJson,
      finalValueJson: correctedValueJson,
      needsReview: false,
      reviewerId: user.id,
      reviewedAt: new Date(),
    },
  });

  revalidatePath(
    `/surveys/${response.submission.batch.surveyId}/batches/${response.submission.batchId}/review/${response.submissionId}`
  );
  return { ok: true };
}

export async function finalizeSubmission(submissionId: string) {
  const user = await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  const submission = await prisma.surveySubmission.findUnique({
    where: { id: submissionId },
    include: {
      batch: true,
      responses: { where: { needsReview: true } },
    },
  });

  if (!submission) throw new Error("Submission not found");

  if (submission.responses.length > 0) {
    throw new Error(
      `${submission.responses.length} response(s) still need review before finalizing.`
    );
  }

  await prisma.surveySubmission.update({
    where: { id: submissionId },
    data: { status: "FINALIZED" },
  });

  await auditLog({
    userId: user.id,
    action: "FINALIZE_SUBMISSION",
    entityType: "SurveySubmission",
    entityId: submissionId,
  });

  // Check if entire batch is now finalized
  const pendingCount = await prisma.surveySubmission.count({
    where: {
      batchId: submission.batchId,
      status: { notIn: ["FINALIZED"] },
    },
  });

  if (pendingCount === 0) {
    await prisma.surveyBatch.update({
      where: { id: submission.batchId },
      data: { status: "FINALIZED" },
    });
  }

  revalidatePath(`/surveys/${submission.batch.surveyId}/batches/${submission.batchId}`);
  revalidatePath(
    `/surveys/${submission.batch.surveyId}/batches/${submission.batchId}/review/${submissionId}`
  );
  return { ok: true };
}

/** Returns the NAME-type question ID for a given survey version, or null if none. */
async function getNameQuestionId(surveyVersionId: string): Promise<string | null> {
  const q = await prisma.surveyQuestion.findFirst({
    where: { surveyVersionId, questionType: "NAME" },
    select: { id: true },
  });
  return q?.id ?? null;
}

/**
 * Decide whether a partial reprocess should clear participantNameExtracted.
 *
 * Rules:
 *  - Full reprocess (changedQuestionIds is absent): always clear — the worker
 *    will re-read the name field from scratch.
 *  - Partial reprocess: only clear if the NAME question is in changedQuestionIds.
 *    If the name isn't being re-extracted we must keep the existing value; the
 *    worker will skip the name field and the DB row would otherwise be blank.
 */
function shouldClearName(
  changedQuestionIds: string[] | undefined,
  nameQuestionId: string | null,
): boolean {
  if (!changedQuestionIds?.length) return true;           // full reprocess
  if (!nameQuestionId) return false;                      // no NAME question in template
  return changedQuestionIds.includes(nameQuestionId);     // partial: only if NAME changed
}

export async function reprocessSubmission(submissionId: string) {
  const user = await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  const submission = await prisma.surveySubmission.findUnique({
    where: { id: submissionId },
    select: {
      staleQuestionIds: true,
      batch: { select: { id: true, surveyId: true, status: true, surveyVersionId: true } },
      responses: {
        select: {
          questionId: true,
          rawExtractedValueJson: true,
          correctedValueJson: true,
        },
      },
    },
  });

  if (!submission) throw new Error("Submission not found");
  if (submission.batch.status === "FINALIZED")
    throw new Error("Cannot reprocess a submission in a finalized batch.");

  // Build previousResults map: questionId → best-known value.
  // Corrected value takes priority (human already reviewed it), then raw extraction.
  const previousResults: Record<string, unknown> = {};
  for (const r of submission.responses) {
    const corrected = r.correctedValueJson as any;
    const raw = r.rawExtractedValueJson as any;
    previousResults[r.questionId] = corrected?.value ?? raw?.value ?? null;
  }

  const changedQuestionIds =
    (submission.staleQuestionIds as string[] | null) ?? undefined;

  // Only clear participantNameExtracted when the NAME field is actually being
  // re-extracted.  For partial reprocesses that don't touch the NAME question,
  // keep the existing value so the participant's identity is never lost.
  const nameQuestionId = await getNameQuestionId(submission.batch.surveyVersionId);
  const clearName = shouldClearName(changedQuestionIds, nameQuestionId);

  await prisma.surveySubmission.update({
    where: { id: submissionId },
    data: {
      status: "NEEDS_REVIEW",
      confidenceScore: null,        // NULL = "not yet processed" sentinel
      isStale: false,
      staleQuestionIds: Prisma.DbNull,
    },
  });

  const { enqueueJob } = await import("@/lib/queue");
  await enqueueJob("submission.extract", {
    submissionId,
    previousResults,
    ...(changedQuestionIds?.length ? { changedQuestionIds } : {}),
  });

  await auditLog({
    userId: user.id,
    action: "REPROCESS_SUBMISSION",
    entityType: "SurveySubmission",
    entityId: submissionId,
  });

  revalidatePath(
    `/surveys/${submission.batch.surveyId}/batches/${submission.batch.id}`
  );
  return { ok: true };
}

export async function syncAllStaleSubmissions(batchId: string) {
  const user = await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  const batch = await prisma.surveyBatch.findUnique({
    where: { id: batchId },
    select: { status: true, surveyId: true, surveyVersionId: true },
  });

  if (!batch) throw new Error("Batch not found");
  if (batch.status === "FINALIZED") throw new Error("Cannot sync a finalized batch.");

  const staleSubmissions = await prisma.surveySubmission.findMany({
    where: { batchId, isStale: true, status: { not: "FINALIZED" } },
    include: {
      responses: {
        select: {
          questionId: true,
          rawExtractedValueJson: true,
          correctedValueJson: true,
        },
      },
    },
  });

  if (staleSubmissions.length === 0) return { queued: 0 };

  // All submissions in a batch share the same survey version — look up the NAME
  // question once so we can make the clear-name decision for every submission.
  const nameQuestionId = await getNameQuestionId(batch.surveyVersionId);

  const { enqueueJob } = await import("@/lib/queue");

  for (const sub of staleSubmissions) {
    // Build previousResults so the AI has full context for unchanged questions.
    const previousResults: Record<string, unknown> = {};
    for (const r of sub.responses) {
      const corrected = r.correctedValueJson as any;
      const raw = r.rawExtractedValueJson as any;
      previousResults[r.questionId] = corrected?.value ?? raw?.value ?? null;
    }

    const changedQuestionIds =
      (sub.staleQuestionIds as string[] | null) ?? undefined;
    const clearName = shouldClearName(changedQuestionIds, nameQuestionId);

    // Reset this submission to "queued for re-extraction".
    await prisma.surveySubmission.update({
      where: { id: sub.id },
      data: {
        status: "NEEDS_REVIEW",
        confidenceScore: null,
        isStale: false,
        staleQuestionIds: Prisma.DbNull,
      },
    });

    await enqueueJob("submission.extract", {
      submissionId: sub.id,
      previousResults,
      ...(changedQuestionIds?.length ? { changedQuestionIds } : {}),
    });
  }

  await auditLog({
    userId: user.id,
    action: "SYNC_STALE_SUBMISSIONS",
    entityType: "SurveyBatch",
    entityId: batchId,
    metadata: { count: staleSubmissions.length },
  });

  revalidatePath(`/surveys/${batch.surveyId}/batches/${batchId}`);
  return { queued: staleSubmissions.length };
}

export async function finalizeBatch(batchId: string) {
  const user = await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  const batch = await prisma.surveyBatch.findUnique({
    where: { id: batchId },
    include: { survey: true },
  });

  if (!batch) throw new Error("Batch not found");
  if (batch.status === "FINALIZED") throw new Error("Batch is already finalized");

  // 1. Materialize finalValueJson for every response in the batch in one SQL round-trip.
  //    COALESCE picks corrected value when present, falls back to the raw extraction.
  await prisma.$executeRaw`
    UPDATE "SurveyResponse"
    SET "finalValueJson" = COALESCE("correctedValueJson", "rawExtractedValueJson"),
        "needsReview"    = false
    WHERE "submissionId" IN (
      SELECT id FROM "SurveySubmission" WHERE "batchId" = ${batchId}
    )
  `;

  // 2. Flip all submissions to FINALIZED.
  await prisma.surveySubmission.updateMany({
    where: { batchId },
    data: { status: "FINALIZED" },
  });

  // 3. Flip the batch itself.
  await prisma.surveyBatch.update({
    where: { id: batchId },
    data: { status: "FINALIZED" },
  });

  await auditLog({
    userId: user.id,
    action: "FINALIZE_BATCH",
    entityType: "SurveyBatch",
    entityId: batchId,
  });

  revalidatePath(`/surveys/${batch.surveyId}/batches/${batchId}`);
  revalidatePath(`/surveys/${batch.surveyId}/batches/${batchId}/bulk-review`);
  return { ok: true };
}

export async function correctParticipantName(submissionId: string, name: string) {
  const user = await requireRole(["ADMIN", "RESEARCHER", "REVIEWER"]);

  const submission = await prisma.surveySubmission.findUnique({
    where: { id: submissionId },
    include: { batch: true },
  });
  if (!submission) throw new Error("Submission not found");

  await prisma.surveySubmission.update({
    where: { id: submissionId },
    data: { participantNameCorrected: name },
  });

  revalidatePath(
    `/surveys/${submission.batch.surveyId}/batches/${submission.batchId}/review/${submissionId}`
  );
  return { ok: true };
}
