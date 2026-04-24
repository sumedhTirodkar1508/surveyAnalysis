"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { revalidatePath } from "next/cache";

import { FieldType } from "@prisma/client";

export async function upsertMapping(data: {
  id?: string;
  questionId: string;
  fieldType: FieldType;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  optionLabel?: string;
}) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const { id, questionId, ...rest } = data;

  const question = await prisma.surveyQuestion.findUnique({
    where: { id: questionId },
    include: { surveyVersion: true },
  });

  if (!question) throw new Error("Question not found");
  if (question.surveyVersion.isActive) throw new Error("Cannot modify an active version.");

  let mapping;
  if (id) {
    mapping = await prisma.fieldMapping.update({
      where: { id },
      data: rest,
    });
  } else {
    mapping = await prisma.fieldMapping.create({
      data: {
        questionId,
        ...rest,
      },
    });
  }

  revalidatePath(`/surveys/${question.surveyVersion.surveyId}/template/builder`);
  return mapping;
}

export async function deleteMapping(mappingId: string) {
  await requireRole(["ADMIN", "RESEARCHER"]);

  const mapping = await prisma.fieldMapping.findUnique({
    where: { id: mappingId },
    include: { question: { include: { surveyVersion: true } } },
  });

  if (!mapping) throw new Error("Mapping not found");
  if (mapping.question.surveyVersion.isActive) throw new Error("Cannot modify an active version.");

  await prisma.fieldMapping.delete({ where: { id: mappingId } });

  revalidatePath(`/surveys/${mapping.question.surveyVersion.surveyId}/template/builder`);
}
