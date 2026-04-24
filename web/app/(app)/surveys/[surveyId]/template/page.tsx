import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { TemplateUploader } from "./TemplateUploader";
import { QuestionEditor } from "@/components/template-builder/QuestionEditor";

export default async function SurveyTemplatePage({
  params,
}: {
  params: { surveyId: string };
}) {
  const { surveyId } = await params;
  
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: { versions: { orderBy: { versionNumber: "desc" }, include: { questions: true } } }
  });

  if (!survey) notFound();

  let targetVersion = survey.versions.find(v => !v.isActive);
  if (!targetVersion) {
    targetVersion = survey.versions[0];
  }

  return (
    <div className="space-y-6">
       <div className="flex items-center gap-4">
        <Link href={`/surveys/${surveyId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Manage Template</h1>
          <p className="text-neutral-500 mt-1">Upload your blank survey PDF to get started.</p>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-6">
        {targetVersion.templateFileId ? (
          <>
            <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-medium">Questions</h3>
              <p className="text-neutral-500 mb-6">Version {targetVersion.versionNumber} has {targetVersion.pageCount} pages.</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/surveys/${surveyId}/template/builder`}>
                <Button variant="secondary">Configure Bounding Boxes</Button>
              </Link>
              <QuestionEditor versionId={targetVersion.id} questionsCount={targetVersion.questions.length} />
            </div>
          </div>

          <div className="space-y-3">
            {survey.versions.flatMap(v => v.id === targetVersion.id ? v.questions : []).sort((a, b) => a.displayOrder - b.displayOrder).map(question => (
              <div key={question.id} className="flex justify-between items-center border p-4 rounded-md">
                <div>
                  <span className="font-semibold mr-2">{question.questionNumber}.</span>
                  {question.questionText}
                  <span className="ml-3 text-xs bg-neutral-100 px-2 py-1 rounded text-neutral-600">
                    {question.questionType.replace(/_/g, ' ')}
                  </span>
                </div>
                <QuestionEditor versionId={targetVersion.id} question={question} />
              </div>
            ))}
            {survey.versions.flatMap(v => v.id === targetVersion.id ? v.questions : []).length === 0 && (
              <div className="text-center py-10 text-neutral-500 border border-dashed rounded-md">
                No questions added yet. Add questions before configuring bounding boxes.
              </div>
            )}
          </div>
          </>
        ) : (
          <TemplateUploader surveyId={surveyId} versionId={targetVersion.id} />
        )}
      </div>
    </div>
  );
}
