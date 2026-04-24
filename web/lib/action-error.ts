import { AuthError } from "@/lib/authz";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

/**
 * Wraps a server action body. Catches AuthError and returns a structured
 * error response. Re-throws any other error.
 */
export async function withAction<T>(
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}
