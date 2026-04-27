import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, Sparkles, Clock, AlertTriangle } from "lucide-react";
import { AnalysisTrigger } from "./AnalysisTrigger";
import { AnalysisPoller } from "./AnalysisPoller";

export const dynamic = "force-dynamic";

export default async function BatchAnalysisPage({
  params,
}: {
  params: Promise<{ surveyId: string; batchId: string }>;
}) {
  const { surveyId, batchId } = await params;

  const batch = await prisma.surveyBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      batchName: true,
      surveyId: true,
      status: true,
      analysisStatus: true,
      analysisReport: true,
      _count: { select: { submissions: true } },
    },
  });

  if (!batch || batch.surveyId !== surveyId) notFound();

  const { analysisStatus, analysisReport } = batch;

  return (
    <div className="space-y-6">
      {/* Poll while analysis is in flight */}
      {(analysisStatus === "QUEUED" || analysisStatus === "PROCESSING") && (
        <AnalysisPoller batchId={batchId} />
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/surveys/${surveyId}/batches/${batchId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-violet-500" />
            <h1 className="text-3xl font-bold tracking-tight">Community Insights</h1>
          </div>
          <p className="text-neutral-500 mt-1">
            {batch.batchName} &middot; {batch._count.submissions} submissions
          </p>
        </div>
        <Link href={`/surveys/${surveyId}/batches/${batchId}/analysis`}>
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </Link>
      </div>

      {/* Not finalized warning */}
      {batch.status !== "FINALIZED" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <p className="font-medium">Batch is not yet finalized</p>
            <p className="mt-0.5">
              Finalize all submissions before generating the report. Only finalized
              responses are included in the analysis.
            </p>
          </div>
        </div>
      )}

      {/* Main content area */}
      {analysisStatus === "NONE" && batch.status === "FINALIZED" && (
        <div className="rounded-lg border bg-white p-12 flex flex-col items-center gap-6 shadow-sm text-center">
          <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-violet-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Generate Community Needs Report</h2>
            <p className="text-neutral-500 max-w-md">
              Gemini 1.5 Pro will analyse all finalized responses and produce a
              detailed report with an executive summary, key findings, and
              actionable recommendations.
            </p>
          </div>
          <AnalysisTrigger batchId={batchId} />
        </div>
      )}

      {(analysisStatus === "QUEUED" || analysisStatus === "PROCESSING") && (
        <div className="rounded-lg border bg-white p-12 flex flex-col items-center gap-6 shadow-sm text-center">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full bg-violet-100 animate-ping opacity-50" />
            <div className="relative w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center">
              <Clock className="w-8 h-8 text-violet-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              {analysisStatus === "QUEUED" ? "Analysis Queued" : "Generating Report…"}
            </h2>
            <p className="text-neutral-500 max-w-md">
              {analysisStatus === "QUEUED"
                ? "The worker will pick this up shortly."
                : "Gemini 1.5 Pro is analysing responses. This usually takes 20–60 seconds."}
            </p>
          </div>
          <p className="text-xs text-neutral-400">This page updates automatically.</p>
        </div>
      )}

      {analysisStatus === "FAILED" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <p className="font-medium text-red-900">Analysis failed</p>
          </div>
          <p className="text-sm text-red-700">
            {analysisReport ?? "An unknown error occurred while generating the report."}
          </p>
          {batch.status === "FINALIZED" && (
            <div className="pt-2">
              <AnalysisTrigger batchId={batchId} label="Retry" />
            </div>
          )}
        </div>
      )}

      {analysisStatus === "COMPLETE" && analysisReport && (
        <article className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-neutral-50 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium text-neutral-700">
              Generated by Gemini 1.5 Pro
            </span>
          </div>
          <div
            className="prose prose-neutral prose-sm max-w-none p-8"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(analysisReport) }}
          />
        </article>
      )}
    </div>
  );
}

/** Minimal Markdown → HTML converter (no external lib needed for server component). */
function renderMarkdown(md: string): string {
  return md
    // Headings
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mt-5 mb-2">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-1.5">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Ordered list items
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Unordered list items
    .replace(/^[-•]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-neutral-300 pl-4 italic text-neutral-600">$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="my-4 border-neutral-200" />')
    // Paragraphs (double newline)
    .replace(/\n\n/g, "</p><p>")
    // Wrap in paragraph tags
    .replace(/^(?!<[hblp])(.+)$/gm, (line) =>
      line.startsWith("<") ? line : `<p>${line}</p>`
    )
    // Clean up empty paragraphs
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<h[1-6])/g, "$1")
    .replace(/(<\/h[1-6]>)<\/p>/g, "$1");
}
