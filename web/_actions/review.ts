"use server";

import { prisma } from "@/lib/db";
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
