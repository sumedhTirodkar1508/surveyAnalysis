/**
 * Edge-compatible Auth.js v5 config.
 *
 * This file MUST NOT import Prisma, bcrypt, pg, or any other Node.js-only
 * module because it is used by middleware.ts which runs in the Edge runtime.
 *
 * The full auth configuration (with PrismaAdapter + Credentials provider)
 * lives in lib/auth.ts and is only imported in Node.js server contexts
 * (server components, route handlers, server actions).
 */
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/sign-in",
  },
  // No providers here — Credentials requires bcrypt (Node.js only).
  // Providers are added in lib/auth.ts.
  providers: [],
  callbacks: {
    // The `authorized` callback runs in the Edge runtime for every request
    // matched by middleware.  It only has access to the JWT token — no DB.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage = nextUrl.pathname.startsWith("/auth");
      const isAuthApi = nextUrl.pathname.startsWith("/api/auth");
      const isPublicFile =
        nextUrl.pathname.startsWith("/_next") ||
        nextUrl.pathname === "/favicon.ico";

      if (isPublicFile) return true;

      if (!isLoggedIn && !isAuthPage && !isAuthApi) {
        const signIn = new URL("/auth/sign-in", nextUrl);
        signIn.searchParams.set("callbackUrl", nextUrl.pathname);
        return Response.redirect(signIn);
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
