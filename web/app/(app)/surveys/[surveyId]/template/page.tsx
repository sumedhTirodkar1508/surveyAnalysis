import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { TemplateUploader } from "./TemplateUploader";
import { QuestionEditor } from "@/components/template-builder/QuestionEditor";
import { ExtractionPoller } from "./ExtractionPoller";
import { ActivateVersionButton } from "./ActivateVersionButton";
import { DraftModeBanner } from "./DraftModeBanner";

export const dynamic = "force-dynamic";

export default async function SurveyTemplatePage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = await params;

  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { questions: { orderBy: { displayOrder: "asc" } } },
      },
    },
  });

  if (!survey) notFound();

  // Prefer the current draft (isActive=false); fall back to the active version if
  // there is no draft (e.g. the researcher hasn't returned it to draft yet).
  const targetVersion =
    survey.versions.find((v) => !v.isActive) ?? survey.versions[0];

  if (!targetVersion) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/surveys/${surveyId}`}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Manage Template</h1>
        </div>
        <div className="bg-white border rounded-lg p-10 text-center text-neutral-500">
          No template version found.{" "}
          <Link href={`/surveys/${surveyId}`} className="text-blue-600 hover:underline">
            Create a new draft version
          </Link>{" "}
          from the survey settings.
        </div>
      </div>
    );
  }

  const isDraft = !targetVersion.isActive;
  const questions = targetVersion.questions;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <Link href={`/surveys/${surveyId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Manage Template</h1>
          <p className="text-neutral-500 mt-1">
            Version {targetVersion.versionNumber}
            {targetVersion.pageCount > 0 && ` · ${targetVersion.pageCount} pages`}
            {targetVersion.pagesPerSubmission > 1 &&
              ` · ${targetVersion.pagesPerSubmission} pages/submission`}
          </p>
        </div>
      </div>

      {/* ── Draft mode banner (animated, only in draft) ───────────────────────── */}
      {isDraft && <DraftModeBanner />}

      {/* ── Upload or questions panel ─────────────────────────────────────────── */}
      <div className="bg-white border rounded-lg p-6">
        {targetVersion.templateFileId ? (
          <>
            {/* Toolbar row */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-medium">
                  Questions
                  {questions.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-neutral-500">
                      ({questions.length})
                    </span>
                  )}
                </h3>
              </div>
              <div className="flex gap-2 items-center">
                <ActivateVersionButton
                  versionId={targetVersion.id}
                  isActive={targetVersion.isActive}
                  questionsCount={questions.length}
                />
                {isDraft && (
                  <QuestionEditor
                    versionId={targetVersion.id}
                    questionsCount={questions.length}
                  />
                )}
              </div>
            </div>

            {/* Question list */}
            <div className="space-y-2">
              {questions.length === 0 ? (
                <div className="text-center py-10 border border-dashed rounded-md space-y-3">
                  <div className="flex items-center justify-center gap-2 text-blue-600">
                    <span
                      className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                    <span className="font-medium">
                      AI is analysing your survey to extract questions…
                    </span>
                  </div>
                  <p className="text-sm text-neutral-500">
                    This takes ~15 seconds. The page updates automatically.
                    <br />
                    You can also add questions manually using the button above.
                  </p>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <ExtractionPoller hasQuestions={false} />
                </div>
              ) : (
                questions.map((question) => (
                  <div
                    key={question.id}
                    className="flex justify-between items-center border rounded-md px-4 py-3 hover:bg-neutral-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-500 shrink-0">
                        {question.questionNumber}
                      </span>
                      <span className="font-medium text-sm truncate">
                        {question.questionText}
                      </span>
                      <span className="ml-1 text-xs bg-neutral-100 px-2 py-0.5 rounded text-neutral-600 shrink-0">
                        {question.questionType.replace(/_/g, " ")}
                      </span>
                    </div>
                    {isDraft && <QuestionEditor versionId={targetVersion.id} question={question} />}
                  </div>
                ))
              )}
            </div>

            {/* Activate hint when all looks good */}
            {isDraft && questions.length > 0 && (
              <p className="text-xs text-neutral-400 mt-4 text-right">
                When all questions are correct, click{" "}
                <strong>Publish Template</strong> to make this version active for
                new batch uploads.
              </p>
            )}
          </>
        ) : (
          /* No template PDF yet — show the uploader */
          <TemplateUploader surveyId={surveyId} versionId={targetVersion.id} />
        )}
      </div>
    </div>
  );
}
