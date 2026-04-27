import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BarChart3, FileText, CheckCircle, Clock, Plus, ArrowRight, User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  const isAdmin = session?.user?.role === "ADMIN";

  // Aggregate stats — all queries run in parallel.
  // Unique-participant count uses a raw SQL DISTINCT on the COALESCE'd name
  // because Prisma's groupBy cannot express computed column distinctness.
  const [
    surveyCount,
    batchCount,
    needsReviewCount,
    finalizedCount,
    recentBatches,
    avgConfidenceAgg,
    uniqueParticipantRows,
    recentFiles,
  ] = await Promise.all([
    prisma.survey.count({ where: isAdmin ? {} : { createdById: userId! } }),
    prisma.surveyBatch.count({ where: isAdmin ? {} : { uploadedById: userId! } }),
    prisma.surveySubmission.count({ where: { status: "NEEDS_REVIEW" } }),
    prisma.surveySubmission.count({ where: { status: "FINALIZED" } }),
    prisma.surveyBatch.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: {
        survey: { select: { id: true, title: true } },
        _count: { select: { submissions: true } },
      },
      where: isAdmin ? {} : { uploadedById: userId! },
    }),
    // Single-pass average — no JS iteration over rows.
    prisma.surveySubmission.aggregate({ _avg: { confidenceScore: true } }),
    // COUNT(DISTINCT ...) on a computed column — cannot be expressed in Prisma ORM.
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(
        DISTINCT LOWER(TRIM(COALESCE(
          "participantNameCorrected",
          "participantNameExtracted",
          'Anonymous'
        )))
      ) AS count
      FROM "SurveySubmission"
    `,
    prisma.batchFile.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { batch: { include: { survey: true } } },
    }),
  ]);

  const avgConfidence = avgConfidenceAgg._avg.confidenceScore ?? 0;
  const uniqueResidentsCount = Number(uniqueParticipantRows[0]?.count ?? 0);

  const stats = [
    {
      label: "Residents Surveyed",
      value: uniqueResidentsCount,
      icon: User,
      color: "bg-blue-50 text-blue-600",
      href: "/participants",
    },
    {
      label: "Avg Tech Confidence",
      value: `${(avgConfidence * 100).toFixed(0)}%`,
      icon: BarChart3,
      color: "bg-purple-50 text-purple-600",
      href: "/participants",
    },
    {
      label: "Needs Review",
      value: needsReviewCount,
      icon: Clock,
      color: "bg-amber-50 text-amber-600",
      href: "/surveys",
    },
    {
      label: "Finalized",
      value: finalizedCount,
      icon: CheckCircle,
      color: "bg-green-50 text-green-600",
      href: "/surveys",
    },
  ];

  const statusColors: Record<string, string> = {
    UPLOADED: "bg-blue-100 text-blue-700",
    PROCESSING: "bg-amber-100 text-amber-700",
    NEEDS_REVIEW: "bg-yellow-100 text-yellow-700",
    FINALIZED: "bg-green-100 text-green-700",
    FAILED: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-neutral-500 mt-1">
            Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}.
          </p>
        </div>
        <Link href="/surveys/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Survey
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <div className="bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <div className={`inline-flex p-2 rounded-lg mb-3 ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <p className="text-3xl font-bold">{s.value}</p>
              <p className="text-sm text-neutral-500 mt-0.5">{s.label}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent batches */}
        <div className="lg:col-span-2 bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-lg">Recent Batches</h2>
            <Link href="/surveys">
              <Button variant="ghost" size="sm">
                View All <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          {recentBatches.length === 0 ? (
            <div className="p-8 text-center text-neutral-400">
              No batches yet. Upload your first batch to get started.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-neutral-500">Batch</th>
                  <th className="text-left px-6 py-3 font-medium text-neutral-500">Survey</th>
                  <th className="text-left px-6 py-3 font-medium text-neutral-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-6 py-4">
                      <Link
                        href={`/surveys/${b.survey.id}/batches/${b.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {b.batchName}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-neutral-600 text-xs">{b.survey.title}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[b.status] ?? "bg-neutral-100 text-neutral-700"}`}
                      >
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Activity (Last 5 PDFs) */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="font-semibold text-lg">Recent Uploads</h2>
          </div>
          <div className="divide-y">
            {recentFiles.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 text-sm">
                No files uploaded recently.
              </div>
            ) : (
              recentFiles.map((file) => (
                <div key={file.id} className="p-4 hover:bg-neutral-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-50 rounded-lg shrink-0">
                      <FileText className="w-4 h-4 text-red-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">PDF Scan #{file.id.slice(-4)}</p>
                      <p className="text-xs text-neutral-500 truncate">
                        {file.batch.batchName} &middot; {file.batch.survey.title}
                      </p>
                      <p className="text-[10px] text-neutral-400 mt-1">
                        {new Date(file.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
