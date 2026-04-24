import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth() before importing the module under test
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { requireUser, requireRole, AuthError } from "@/lib/authz";

const mockAuth = auth as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUser", () => {
  it("returns user when session is valid", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", role: "RESEARCHER" },
    });
    const user = await requireUser();
    expect(user.id).toBe("u1");
  });

  it("throws UNAUTHENTICATED when session is null", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("throws UNAUTHENTICATED when session has no user id", async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expect(requireUser()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("requireRole", () => {
  it("returns user when role matches", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", role: "ADMIN" },
    });
    const user = await requireRole(["ADMIN", "RESEARCHER"]);
    expect(user.role).toBe("ADMIN");
  });

  it("throws FORBIDDEN when role does not match", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", role: "VIEWER" },
    });
    await expect(requireRole(["ADMIN", "RESEARCHER"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws UNAUTHENTICATED (not FORBIDDEN) when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireRole(["ADMIN"])).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
