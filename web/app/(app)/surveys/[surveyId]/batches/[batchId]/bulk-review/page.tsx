import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { BulkReviewClient } from "./BulkReviewClient";

export const dynamic = "force-dynamic";

export default async function BulkReviewPage({
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
        include: {
          responses: {
            include: {
              question: {
                include: { fieldMappings: true },
              },
            },
            orderBy: { question: { displayOrder: "asc" } },
          },
        },
      },
    },
  });

  if (!batch || batch.surveyId !== surveyId) notFound();

  // Bulk review makes sense for NEEDS_REVIEW and FINALIZED batches.
  // Block if still processing — nothing to review yet.
  if (batch.status === "PROCESSING" || batch.status === "UPLOADED") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/surveys/${surveyId}/batches/${batchId}`}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Bulk Review</h1>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-amber-800">
          Extraction is still in progress. Come back once the batch status is{" "}
          <strong>Needs Review</strong>.
        </div>
      </div>
    );
  }

  const totalNeedsReview = batch.submissions.reduce(
    (acc, s) => acc + s.responses.filter((r) => r.needsReview).length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/surveys/${surveyId}/batches/${batchId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Bulk Review</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {batch.batchName} &middot; {batch.submissions.length} participant
            {batch.submissions.length !== 1 ? "s" : ""}
            {totalNeedsReview > 0 && (
              <span className="text-amber-600 ml-2">
                · {totalNeedsReview} field{totalNeedsReview !== 1 ? "s" : ""} flagged
              </span>
            )}
          </p>
        </div>
      </div>

      <BulkReviewClient
        submissions={batch.submissions as any}
        batchId={batchId}
        surveyId={surveyId}
      />
    </div>
  );
}
