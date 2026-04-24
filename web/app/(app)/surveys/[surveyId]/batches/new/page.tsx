"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Dropzone } from "@/components/uploads/Dropzone";
import { createBatch } from "@/_actions/batches";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewBatchPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = use(params);
  const router = useRouter();
  const [batchName, setBatchName] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleUploadComplete = async (results: {fileId: string, pageCount?: number}[]) => {
    if (results.length === 0) return;
    
    setUploading(true);
    try {
      const name = batchName.trim() || `Batch ${new Date().toLocaleString()}`;
      const fileIds = results.map(r => r.fileId);
      
      const batch = await createBatch(surveyId, name, fileIds);
      toast.success(`Batch "${batch.batchName}" created with ${fileIds.length} files.`);
      router.push(`/surveys/${surveyId}/batches/${batch.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create batch");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href={`/surveys/${surveyId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Upload Survey Scans</h1>
          <p className="text-neutral-500 mt-1">Upload filled PDF surveys to be processed.</p>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-6 space-y-6 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="batchName">Batch Name (Optional)</Label>
          <Input 
            id="batchName" 
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="e.g. October 2023 Collection"
            disabled={uploading}
          />
        </div>

        <div className="space-y-2">
          <Label>Upload PDF Scans</Label>
          <div className={uploading ? "pointer-events-none opacity-50" : ""}>
            <Dropzone 
              kind="RESULT_PDF" 
              surveyId={surveyId}
              maxFiles={500}
              onUploadComplete={handleUploadComplete}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
