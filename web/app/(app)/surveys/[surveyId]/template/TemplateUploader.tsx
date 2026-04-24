"use client";

import { Dropzone } from "@/components/uploads/Dropzone";
import { attachTemplate } from "@/_actions/versions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function TemplateUploader({ surveyId, versionId }: { surveyId: string, versionId: string }) {
  const router = useRouter();

  const handleSuccess = async (fileId: string, pageCount?: number) => {
    try {
      await attachTemplate(versionId, fileId, pageCount || 1);
      toast.success("Template uploaded successfully!");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to attach template.");
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-medium">Upload Blank Survey</h3>
        <p className="text-sm text-neutral-500 mt-1">
          This should be a clean, unfilled PDF. We will use it as the background for drawing bounding boxes.
        </p>
      </div>
      
      <Dropzone 
        kind="SURVEY_TEMPLATE" 
        surveyId={surveyId} 
        onSuccess={handleSuccess} 
      />
    </div>
  );
}
