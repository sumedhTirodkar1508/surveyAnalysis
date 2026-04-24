import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAuthPage = req.nextUrl.pathname.startsWith("/auth");
  // Allow NextAuth's own /api/auth/* callbacks through unauthenticated.
  // All other /api/* routes are also gated here — per-route requireRole()
  // handles authorization, but we prevent completely unauthenticated requests
  // from reaching them without even a session check.
  const isAuthApi = req.nextUrl.pathname.startsWith("/api/auth");

  if (!isLoggedIn && !isAuthPage && !isAuthApi) {
    return NextResponse.redirect(new URL("/auth/sign-in", req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
