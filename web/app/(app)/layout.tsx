import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, FileText, Users, LogOut } from "lucide-react";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const isAdmin = session.user.role === "ADMIN";

  return (
    <div className="min-h-screen bg-neutral-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r flex flex-col hidden md:flex">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
            SurveyDigitizer
          </h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors">
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </Link>
          <Link href="/surveys" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors">
            <FileText className="w-4 h-4" />
            Surveys
          </Link>
          
          {isAdmin && (
            <Link href="/admin/users" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors">
              <Users className="w-4 h-4" />
              Admin
            </Link>
          )}
        </nav>
        
        <div className="p-4 border-t flex flex-col gap-3">
          <div className="px-3">
            <p className="text-sm font-medium text-neutral-900 truncate">{session.user.name || "User"}</p>
            <p className="text-xs text-neutral-500 truncate">{session.user.email}</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase mt-1">{session.user.role}</p>
          </div>
          <form action={async () => {
            "use server";
            await signOut();
          }}>
            <Button variant="ghost" className="w-full justify-start text-neutral-600 hover:text-red-600 hover:bg-red-50">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
