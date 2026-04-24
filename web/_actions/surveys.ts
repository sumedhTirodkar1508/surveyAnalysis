"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { revalidatePath } from "next/cache";

export async function listSurveys() {
  const user = await requireUser();
  
  // Admins see all, others see what they created (for MVP)
  const where = user.role === "ADMIN" ? {} : { createdById: user.id };

  return prisma.survey.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { batches: true }
      },
      versions: {
        where: { isActive: true },
        take: 1
      }
    }
  });
}

export async function createSurvey(title: string, description?: string) {
  const user = await requireUser();
  if (!["ADMIN", "RESEARCHER"].includes(user.role)) {
    throw new Error("Forbidden");
  }

  const survey = await prisma.survey.create({
    data: {
      title,
      description,
      createdById: user.id,
      versions: {
        create: {
          versionNumber: 1,
          pageCount: 0,
          isActive: false,
        }
      }
    }
  });

  revalidatePath("/surveys");
  return survey;
}

export async function updateSurvey(surveyId: string, title: string, description?: string) {
  const user = await requireUser();
  const survey = await prisma.survey.findUnique({ where: { id: surveyId }});
  
  if (!survey || (user.role !== "ADMIN" && survey.createdById !== user.id)) {
    throw new Error("Forbidden");
  }

  const updated = await prisma.survey.update({
    where: { id: surveyId },
    data: { title, description }
  });

  revalidatePath(`/surveys`);
  revalidatePath(`/surveys/${surveyId}`);
  return updated;
}

export async function archiveSurvey(surveyId: string) {
  const user = await requireUser();
  const survey = await prisma.survey.findUnique({ where: { id: surveyId }});
  
  if (!survey || (user.role !== "ADMIN" && survey.createdById !== user.id)) {
    throw new Error("Forbidden");
  }

  const archived = await prisma.survey.update({
    where: { id: surveyId },
    data: { status: "ARCHIVED" }
  });

  revalidatePath("/surveys");
  revalidatePath(`/surveys/${surveyId}`);
  return archived;
}
