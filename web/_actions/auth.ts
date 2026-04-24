"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const signUpSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters"),
});

export type SignUpState = {
  error?: string;
  success?: boolean;
};

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, email, password } = parsed.data;

  // Hash unconditionally before insert to avoid timing oracle on email existence
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await prisma.user.create({
      data: { name, email, passwordHash, role: "VIEWER" },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { error: "An account with this email already exists." };
    }
    throw e;
  }

  return { success: true };
}
