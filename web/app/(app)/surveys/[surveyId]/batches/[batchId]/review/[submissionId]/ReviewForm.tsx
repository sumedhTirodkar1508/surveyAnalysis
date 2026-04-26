"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckSquare, Square, AlertCircle, CheckCircle2, User } from "lucide-react";
import { saveResponseCorrection, finalizeSubmission, correctParticipantName } from "@/_actions/review";
import { toast } from "sonner";
import Image from "next/image";

interface ResponseCardProps {
  response: any;
  previewUrls: Record<string, string>;
  onSave: (corrected: any) => Promise<void>;
}

function CheckboxResponseCard({ response, previewUrls, onSave }: ResponseCardProps) {
  const raw = response.rawExtractedValueJson as any;
  const existing = response.correctedValueJson as any;
  
  // All possible options come from the mappings
  const options: string[] = response.question.fieldMappings.map((m: any) => m.optionLabel || `option_${m.id}`);
  
  // What is actually checked? 
  // 'existing' (if saved via UI) will be an array of strings.
  // 'raw' (from worker) will be an array of objects: { label, fill_ratio, preview_path }.
  const rawSelected: string[] = raw?.selected?.map((s: any) => s.label) ?? [];
  const initialSelected: string[] = existing?.selected ?? rawSelected;

  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [pending, startTransition] = useTransition();

  const handleToggle = (label: string) => {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const handleSave = () => {
    startTransition(async () => {
      await onSave({ type: "checkbox", selected, corrected: true });
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((label) => (
          <button
            key={label}
            onClick={() => handleToggle(label)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors ${
              selected.includes(label)
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-neutral-700 border-neutral-300 hover:border-neutral-400"
            }`}
          >
            {selected.includes(label) ? (
              <CheckSquare className="w-4 h-4" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {label}
          </button>
        ))}
      </div>
      {/* Previews */}
      {raw?.selected?.map((s: any) => {
        // find mapping id from raw that has this label
        const mappingId = response.question.fieldMappings.find(
          (m: any) => m.optionLabel === s.label
        )?.id;
        const url = mappingId ? previewUrls[mappingId] : undefined;
        return url ? (
          <div key={s.label} className="inline-block mr-2">
            <p className="text-xs text-neutral-500 mb-1">{s.label}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={s.label} className="h-10 w-auto border rounded" />
          </div>
        ) : null;
      })}
      <Button size="sm" onClick={handleSave} disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function TextResponseCard({ response, previewUrls, onSave }: ResponseCardProps) {
  const raw = response.rawExtractedValueJson as any;
  const existing = response.correctedValueJson as any;
  const [value, setValue] = useState<string>(existing?.value ?? raw?.value ?? "");
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      await onSave({ type: "text", value, corrected: true });
    });
  };

  // Find first preview
  const mappingId = response.question.fieldMappings[0]?.id;
  const previewUrl = mappingId ? previewUrls[mappingId] : undefined;

  return (
    <div className="space-y-3">
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Field preview"
          className="h-14 w-auto border rounded object-contain bg-neutral-50"
        />
      )}
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-sm"
          placeholder="Extracted text..."
        />
        <Button size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

interface ReviewFormProps {
  submission: any;
  previewUrls: Record<string, string>;
  nextSubmissionId: string | null;
  surveyId: string;
  batchId: string;
}

export function ReviewForm({ submission, previewUrls, nextSubmissionId, surveyId, batchId }: ReviewFormProps) {
  const router = useRouter();
  const [participantName, setParticipantName] = useState(
    submission.participantNameCorrected ?? submission.participantNameExtracted ?? ""
  );
  const [savingName, setSavingName] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const handleSaveResponse = async (responseId: string, corrected: any) => {
    try {
      await saveResponseCorrection(responseId, corrected);
      toast.success("Response saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    }
  };

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      await correctParticipantName(submission.id, participantName);
      toast.success("Name saved");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingName(false);
    }
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    try {
      await finalizeSubmission(submission.id);
      toast.success("Submission finalized!");
      if (nextSubmissionId) {
        router.push(`/surveys/${surveyId}/batches/${batchId}/review/${nextSubmissionId}`);
      } else {
        router.push(`/surveys/${surveyId}/batches/${batchId}`);
      }
    } catch (err: any) {
      toast.error(err.message);
      setFinalizing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Participant name */}
      <div className="bg-white border rounded-lg p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-neutral-400" />
          <h3 className="font-semibold">Participant Name</h3>
        </div>
        <div className="flex gap-2 items-center max-w-sm">
          <Input
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
            placeholder="Enter participant name..."
          />
          <Button size="sm" variant="outline" onClick={handleSaveName} disabled={savingName}>
            {savingName ? "..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Response cards */}
      {submission.responses.map((r: any) => {
        const raw = r.rawExtractedValueJson as any;
        const fieldType = raw?.type ?? "text";
        const isReviewed = !r.needsReview;

        return (
          <div
            key={r.id}
            className={`bg-white border rounded-lg p-5 shadow-sm space-y-3 ${
              r.needsReview ? "border-amber-300" : "border-green-200"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-mono bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-500 mr-2">
                  {r.question.questionNumber}
                </span>
                <span className="font-medium">{r.question.questionText}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                {r.confidenceScore != null && (
                  <span className="text-xs text-neutral-400">
                    {(r.confidenceScore * 100).toFixed(0)}% conf
                  </span>
                )}
                {isReviewed ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
              </div>
            </div>

            {fieldType === "checkbox" ? (
              <CheckboxResponseCard
                response={r}
                previewUrls={previewUrls}
                onSave={(val) => handleSaveResponse(r.id, val)}
              />
            ) : (
              <TextResponseCard
                response={r}
                previewUrls={previewUrls}
                onSave={(val) => handleSaveResponse(r.id, val)}
              />
            )}
          </div>
        );
      })}

      {/* Finalize */}
      <div className="flex justify-end pt-2">
        <Button
          size="lg"
          onClick={handleFinalize}
          disabled={finalizing}
          className="bg-green-600 hover:bg-green-700"
        >
          {finalizing ? "Finalizing..." : nextSubmissionId ? "Finalize & Next →" : "Finalize Submission"}
        </Button>
      </div>
    </div>
  );
}
