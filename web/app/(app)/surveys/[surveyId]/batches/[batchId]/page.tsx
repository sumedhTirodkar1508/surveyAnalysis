import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, Download } from "lucide-react";
import { BatchStatusBadge } from "@/components/batches/BatchStatusBadge";
import { SubmissionsTable } from "@/components/batches/SubmissionsTable";

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

  return (
    <div className="space-y-6">
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
          <a href={`/api/batches/${batchId}/export`} download>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export Excel
            </Button>
          </a>
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

      {/* Extraction job progress */}
      {latestJob && latestJob.status !== "COMPLETED" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          {latestJob.status === "QUEUED" && "⏳ Extraction job is queued. The worker will pick it up shortly."}
          {latestJob.status === "PROCESSING" && "⚙️ Extraction is in progress. Refresh to see updates."}
          {latestJob.status === "FAILED" && `❌ Extraction failed: ${latestJob.errorMessage ?? "Unknown error"}`}
        </div>
      )}

      {/* Submissions table */}
      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">Submissions</h2>
          {needsReviewCount > 0 && (
            <Link href={`/surveys/${surveyId}/batches/${batchId}/review`}>
              <Button>Review {needsReviewCount} Submissions</Button>
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
