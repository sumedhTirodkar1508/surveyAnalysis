import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ReviewForm } from "./ReviewForm";
import { createSignedDownloadUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function ReviewSubmissionPage({
  params,
}: {
  params: { surveyId: string; batchId: string; submissionId: string };
}) {
  const { surveyId, batchId, submissionId } = await params;

  // Fetch submission with all responses and their questions
  const submission = await prisma.surveySubmission.findUnique({
    where: { id: submissionId },
    include: {
      batch: true,
      responses: {
        include: {
          question: {
            include: { fieldMappings: true },
          },
        },
        orderBy: { question: { displayOrder: "asc" } },
      },
    },
  });

  if (!submission || submission.batchId !== batchId) notFound();

  // Fetch surrounding submissions for prev/next navigation
  const siblings = await prisma.surveySubmission.findMany({
    where: { batchId },
    orderBy: { participantIndex: "asc" },
    select: { id: true, participantIndex: true, status: true },
  });

  const currentIdx = siblings.findIndex((s) => s.id === submissionId);
  const prevSub = siblings[currentIdx - 1] ?? null;
  const nextSub = siblings[currentIdx + 1] ?? null;

  // Gather all preview image paths for this submission
  const previewAssets = await prisma.fileAsset.findMany({
    where: {
      surveyId,
      storagePath: { contains: `submissions/${submissionId}/previews/` },
    },
  });

  // Sign preview URLs
  const previewUrls: Record<string, string> = {};
  await Promise.all(
    previewAssets.map(async (a) => {
      try {
        const { signedUrl } = await createSignedDownloadUrl(a.storagePath, 3600);
        // Key by mapping id extracted from filename: mapping-{id}.jpg
        const match = a.storagePath.match(/mapping-([^.]+)\.jpg/);
        if (match) previewUrls[match[1]] = signedUrl;
      } catch {}
    })
  );

  const needsReviewCount = submission.responses.filter((r) => r.needsReview).length;

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
          <h1 className="text-2xl font-bold tracking-tight">
            Submission #{submission.participantIndex}
            {(submission.participantNameCorrected || submission.participantNameExtracted) && (
              <span className="text-neutral-500 font-normal ml-2 text-lg">
                — {submission.participantNameCorrected ?? submission.participantNameExtracted}
              </span>
            )}
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {needsReviewCount > 0 ? (
              <span className="text-amber-600 font-medium">{needsReviewCount} field(s) need review</span>
            ) : (
              <span className="text-green-600 font-medium">All fields reviewed ✓</span>
            )}
          </p>
        </div>

        {/* Prev/Next navigation */}
        <div className="flex gap-2">
          {prevSub ? (
            <Link href={`/surveys/${surveyId}/batches/${batchId}/review/${prevSub.id}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled><ArrowLeft className="w-4 h-4 mr-1" /> Prev</Button>
          )}
          {nextSub ? (
            <Link href={`/surveys/${surveyId}/batches/${batchId}/review/${nextSub.id}`}>
              <Button variant="outline" size="sm">
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
          )}
        </div>
      </div>

      {/* Review Form */}
      <ReviewForm
        submission={submission as any}
        previewUrls={previewUrls}
        nextSubmissionId={nextSub?.id ?? null}
        surveyId={surveyId}
        batchId={batchId}
      />
    </div>
  );
}
