"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileUp, Loader2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { FileAssetType } from "@prisma/client";

// Set worker path to local file (we'll need to copy it to public folder, or use unpkg)
// For Next.js App Router, using a CDN is easiest for MVP
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface DropzoneProps {
  kind: FileAssetType;
  surveyId?: string;
  batchId?: string;
  onSuccess?: (fileId: string, pageCount?: number) => void;
  onUploadComplete?: (results: {fileId: string, pageCount?: number}[]) => void;
  accept?: Record<string, string[]>;
  maxFiles?: number;
}

export function Dropzone({ kind, surveyId, batchId, onSuccess, onUploadComplete, accept = { "application/pdf": [".pdf"] }, maxFiles = 1 }: DropzoneProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getPageCount = async (file: File): Promise<number> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return pdf.numPages;
  };

  const uploadFile = async (file: File) => {
    const signRes = await fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        surveyId,
        batchId,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      }),
    });

    if (!signRes.ok) {
      const err = await signRes.json();
      throw new Error(err.error || "Failed to get signed URL");
    }

    const { signedUrl, fileId } = await signRes.json();

    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error("Failed to upload file to storage");
    }

    return fileId;
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setError(null);
    if (acceptedFiles.length === 0) return;

    setUploading(true);
    const results: {fileId: string, pageCount?: number}[] = [];
    
    try {
      for (const file of acceptedFiles) {
        let pageCount = undefined;
        if (file.type === "application/pdf") {
          pageCount = await getPageCount(file);
        }
        
        const fileId = await uploadFile(file);
        results.push({ fileId, pageCount });
        if (onSuccess) onSuccess(fileId, pageCount);
      }
      if (onUploadComplete) onUploadComplete(results);
    } catch (err: any) {
      setError(err.message || "An error occurred during upload.");
    } finally {
      setUploading(false);
    }
  }, [kind, surveyId, batchId, onSuccess, onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles,
    maxSize: 20 * 1024 * 1024, // 20MB
    disabled: uploading,
  });

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
          ${isDragActive ? "border-blue-500 bg-blue-50" : "border-neutral-300 bg-neutral-50 hover:bg-neutral-100"}
          ${uploading ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <input {...getInputProps()} />
        
        {uploading ? (
          <div className="flex flex-col items-center justify-center text-neutral-500">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-blue-500" />
            <p className="text-sm font-medium">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-neutral-500">
            <FileUp className="w-10 h-10 mb-4 text-neutral-400" />
            <p className="text-sm font-medium text-neutral-900 mb-1">
              {isDragActive ? "Drop the file here" : "Click or drag file to this area to upload"}
            </p>
            <p className="text-xs text-neutral-500">
              PDF only, up to 20MB
            </p>
          </div>
        )}
      </div>
      
      {error && (
        <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>
      )}
    </div>
  );
}
