import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { createSignedDownloadUrl } from "@/lib/storage";
import { BuilderUX } from "./BuilderUX";

export default async function TemplateBuilderPage({
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
        include: { 
          questions: { 
            include: { fieldMappings: true },
            orderBy: { displayOrder: "asc" }
          } 
        }
      } 
    }
  });

  if (!survey) notFound();

  let targetVersion = survey.versions.find(v => !v.isActive);
  if (!targetVersion) {
    targetVersion = survey.versions[0];
  }

  // Fetch page images
  const pageAssets = await prisma.fileAsset.findMany({
    where: { surveyId, type: "PAGE_IMAGE" },
    orderBy: { storagePath: "asc" }
  });

  // Since rendering happens asynchronously, we might not have them yet.
  // We should tell the user if they are missing.
  if (pageAssets.length === 0 && targetVersion.templateFileId) {
    return (
      <div className="p-8 text-center text-neutral-500 bg-white border rounded-lg">
        <h3 className="text-lg font-medium text-neutral-900 mb-2">Processing Template</h3>
        <p>We are currently generating the page images from your uploaded PDF.</p>
        <p className="mt-2 text-sm">Please refresh in a few moments.</p>
      </div>
    );
  }

  // Generate signed URLs
  const pageUrls = await Promise.all(
    pageAssets.map(async (asset) => {
      const res = await createSignedDownloadUrl(asset.storagePath, 3600);
      return res.signedUrl;
    })
  );

  return (
    <div className="h-[calc(100vh-6rem)] -m-6 flex flex-col overflow-hidden">
      <BuilderUX 
        surveyId={surveyId}
        versionId={targetVersion.id}
        questions={targetVersion.questions}
        pageUrls={pageUrls}
        isActive={targetVersion.isActive}
      />
    </div>
  );
}
