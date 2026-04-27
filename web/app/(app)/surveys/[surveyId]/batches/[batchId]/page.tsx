import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, Download, ClipboardList, AlertTriangle, Sparkles } from "lucide-react";
import { BatchStatusBadge } from "@/components/batches/BatchStatusBadge";
import { SubmissionsTable } from "@/components/batches/SubmissionsTable";
import { BatchPoller } from "@/components/batches/BatchPoller";
import { SyncStaleButton } from "@/components/batches/SyncStaleButton";

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ surveyId: string; batchId: string }>;
}) {
  const { surveyId, batchId } = await params;

  const batch = await prisma.surveyBatch.findUnique({
    where: { id: batchId },
    include: {
      survey: true,
      submissions: {
        orderBy: { participantIndex: "asc" },
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { submissions: true } },
    },
  });

  if (!batch || batch.surveyId !== surveyId) notFound();

  const latestJob = batch.jobs[0];
  const needsReviewCount = batch.submissions.filter(
    (s) => s.status === "NEEDS_REVIEW"
  ).length;
  const finalizedCount = batch.submissions.filter(
    (s) => s.status === "FINALIZED"
  ).length;
  // True when ≥1 submission was just reprocessed (confidenceScore reset to NULL).
  // BatchPoller uses this to keep polling even when batch status is NEEDS_REVIEW.
  const hasNullScores = batch.submissions.some((s) => s.confidenceScore === null);

  // Count stale submissions (template was edited in draft after extraction).
  const staleCount = batch.submissions.filter((s) => (s as any).isStale === true).length;

  return (
    <div className="space-y-6">
      {/* Auto-refresh while extraction is in progress OR a reprocess job is running */}
      <BatchPoller batchId={batchId} initialStatus={batch.status} hasNullScores={hasNullScores} />
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/surveys/${surveyId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{batch.batchName}</h1>
            <BatchStatusBadge status={batch.status} />
          </div>
          <p className="text-neutral-500 mt-1">
            Survey: {batch.survey.title} &middot; {batch._count.submissions} submissions
          </p>
        </div>
        <div className="flex gap-2">
          {batch._count.submissions > 0 ? (
            <a href={`/api/batches/${batchId}/export`} download>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export to Excel
              </Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <Download className="w-4 h-4 mr-2" />
              Export to Excel
            </Button>
          )}
          <Link href={`/surveys/${surveyId}/batches/${batchId}`}>
            <Button variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: batch._count.submissions },
          { label: "Needs Review", value: needsReviewCount },
          { label: "Finalized", value: finalizedCount },
          {
            label: "Job Status",
            value: latestJob?.status ?? "N/A",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border rounded-lg p-5 shadow-sm">
            <p className="text-sm text-neutral-500">{stat.label}</p>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Extraction job progress — only while the batch is actively being processed and job is not finished */}
      {batch.status === "PROCESSING" && latestJob && latestJob.status !== "COMPLETED" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {latestJob.status === "QUEUED" && "⏳ Extraction job is queued. The worker will pick it up shortly."}
          {latestJob.status === "PROCESSING" &&
            "⚙️ Extraction is in progress. This page will update automatically."}
          {latestJob.status === "FAILED" && `❌ Extraction failed: ${latestJob.errorMessage ?? "Unknown error"}`}
        </div>
      )}

      {/* Stale submissions banner — template was edited after extraction */}
      {staleCount > 0 && batch.status !== "FINALIZED" && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900">
                {staleCount} submission{staleCount !== 1 ? "s" : ""} are stale
              </p>
              <p className="text-sm text-amber-700 mt-0.5">
                The survey template was updated since these submissions were extracted.
                Only the changed question{staleCount !== 1 ? "s" : ""} will be re-extracted — all other answers are preserved.
              </p>
            </div>
          </div>
          <SyncStaleButton batchId={batchId} staleCount={staleCount} />
        </div>
      )}

      {/* Bulk Review CTA — only while there is something to review */}
      {batch.status === "NEEDS_REVIEW" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-blue-900">Ready for review</p>
            <p className="text-sm text-blue-700 mt-0.5">
              Review all participant responses on one page, then lock the batch for export.
            </p>
          </div>
          <Link href={`/surveys/${surveyId}/batches/${batchId}/bulk-review`}>
            <Button className="bg-blue-600 hover:bg-blue-700 gap-2 shrink-0">
              <ClipboardList className="w-4 h-4" />
              Bulk Review &amp; Finalize
            </Button>
          </Link>
        </div>
      )}

      {/* Community Insights CTA — visible once batch is finalized */}
      {batch.status === "FINALIZED" && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-violet-900">Community Insights available</p>
            <p className="text-sm text-violet-700 mt-0.5">
              Generate an AI-powered needs report with executive summary and recommendations.
              {batch.analysisStatus === "COMPLETE" && " Report is ready to view."}
              {batch.analysisStatus === "PROCESSING" && " Report is being generated…"}
              {batch.analysisStatus === "QUEUED" && " Report generation is queued."}
            </p>
          </div>
          <Link href={`/surveys/${surveyId}/batches/${batchId}/analysis`}>
            <Button className="bg-violet-600 hover:bg-violet-700 gap-2 shrink-0">
              <Sparkles className="w-4 h-4" />
              {batch.analysisStatus === "COMPLETE"
                ? "View Report"
                : "View Community Insights"}
            </Button>
          </Link>
        </div>
      )}

      {/* Submissions table */}
      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">Submissions</h2>
          {needsReviewCount > 0 && (
            <Link href={`/surveys/${surveyId}/batches/${batchId}/review`}>
              <Button variant="outline" size="sm">
                Review individually
              </Button>
            </Link>
          )}
        </div>
        <SubmissionsTable
          submissions={batch.submissions}
          surveyId={surveyId}
          batchId={batchId}
        />
      </div>
    </div>
  );
}
