"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";

export async function changeUserRole(targetUserId: string, newRole: Role) {
  const admin = await requireRole(["ADMIN"]);

  if (targetUserId === admin.id) {
    throw new Error("You cannot change your own role.");
  }

  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw new Error("User not found");

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "CHANGE_ROLE",
      entityType: "User",
      entityId: targetUserId,
      metadataJson: { oldRole: user.role, newRole },
    }
  });

  revalidatePath("/admin/users");
  return updated;
}
