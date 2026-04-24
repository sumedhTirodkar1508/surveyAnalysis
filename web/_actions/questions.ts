"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { QuestionType } from "@prisma/client";

export async function upsertQuestion(data: {
  id?: string;
  surveyVersionId: string;
  questionNumber: string;
  questionText: string;
  questionType: QuestionType;
  optionsJson?: any;
  matrixRowsJson?: any;
  matrixColumnsJson?: any;
  displayOrder: number;
}) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const { id, surveyVersionId, ...rest } = data;

  const version = await prisma.surveyVersion.findUnique({
    where: { id: surveyVersionId },
    select: { surveyId: true, isActive: true },
  });

  if (!version) throw new Error("Version not found");
  if (version.isActive) throw new Error("Cannot modify an active version.");

  let question;
  if (id) {
    question = await prisma.surveyQuestion.update({
      where: { id },
      data: rest,
    });
  } else {
    question = await prisma.surveyQuestion.create({
      data: {
        surveyVersionId,
        ...rest,
      },
    });
  }

  revalidatePath(`/surveys/${version.surveyId}/template`);
  return question;
}

export async function deleteQuestion(questionId: string) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const question = await prisma.surveyQuestion.findUnique({
    where: { id: questionId },
    include: { surveyVersion: true },
  });

  if (!question) throw new Error("Question not found");
  if (question.surveyVersion.isActive) throw new Error("Cannot modify an active version.");

  await prisma.surveyQuestion.delete({ where: { id: questionId } });

  revalidatePath(`/surveys/${question.surveyVersion.surveyId}/template`);
}

export async function reorderQuestions(surveyVersionId: string, orderedIds: string[]) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const version = await prisma.surveyVersion.findUnique({
    where: { id: surveyVersionId },
    select: { surveyId: true, isActive: true },
  });

  if (!version) throw new Error("Version not found");
  if (version.isActive) throw new Error("Cannot modify an active version.");

  const updates = orderedIds.map((id, index) => 
    prisma.surveyQuestion.update({
      where: { id },
      data: { displayOrder: index },
    })
  );

  await prisma.$transaction(updates);

  revalidatePath(`/surveys/${version.surveyId}/template`);
}
