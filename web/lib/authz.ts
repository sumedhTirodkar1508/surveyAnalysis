import { auth } from "@/lib/auth";
import type { Role } from "@prisma/client";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Returns the current session user or throws AuthError(UNAUTHENTICATED).
 * Use inside server actions and API route handlers.
 */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthError("You must be signed in.", "UNAUTHENTICATED");
  }
  return session.user;
}

/**
 * Returns the current session user if their role is in `allowedRoles`,
 * otherwise throws AuthError.
 */
export async function requireRole(allowedRoles: Role[]) {
  const user = await requireUser();
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError(
      `This action requires one of: ${allowedRoles.join(", ")}.`,
      "FORBIDDEN"
    );
  }
  return user;
}
