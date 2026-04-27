"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckSquare,
  Square,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  User,
  Lock,
  Braces,
} from "lucide-react";
import {
  saveResponseCorrection,
  correctParticipantName,
  finalizeBatch,
} from "@/_actions/review";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldMapping {
  id: string;
  optionLabel: string | null;
}

interface Question {
  id: string;
  questionNumber: string;
  questionText: string;
  fieldMappings: FieldMapping[];
}

interface BulkResponse {
  id: string;
  needsReview: boolean;
  confidenceScore: number | null;
  rawExtractedValueJson: any;
  correctedValueJson: any;
  question: Question;
}

interface BulkSubmission {
  id: string;
  participantIndex: number;
  participantNameExtracted: string | null;
  participantNameCorrected: string | null;
  status: string;
  responses: BulkResponse[];
}

interface BulkReviewClientProps {
  submissions: BulkSubmission[];
  batchId: string;
  surveyId: string;
}

// ─── Response card: checkboxes ─────────────────────────────────────────────────

function CheckboxCard({ response }: { response: BulkResponse }) {
  const raw = response.rawExtractedValueJson as any;
  const existing = response.correctedValueJson as any;

  const options: string[] = response.question.fieldMappings.map(
    (m) => m.optionLabel ?? `option_${m.id}`
  );

  const rawSelected: string[] = raw?.selected?.map((s: any) => s.label) ?? [];
  const [selected, setSelected] = useState<string[]>(
    existing?.selected ?? rawSelected
  );
  const [pending, start] = useTransition();

  const toggle = (label: string) =>
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );

  const save = () =>
    start(async () => {
      try {
        await saveResponseCorrection(response.id, {
          type: "checkbox",
          selected,
          corrected: true,
        });
        toast.success("Saved");
      } catch (e: any) {
        toast.error(e.message ?? "Failed to save");
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((label) => (
          <button
            key={label}
            onClick={toggle.bind(null, label)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
              selected.includes(label)
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-neutral-700 border-neutral-300 hover:border-neutral-400"
            }`}
          >
            {selected.includes(label) ? (
              <CheckSquare className="w-3.5 h-3.5" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            {label}
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={save} disabled={pending} className="h-7 text-xs">
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

// ─── Collapsible JSON editor (reused for matrix / multi-select in bulk view) ──

function BulkCollapsibleJsonEditor({
  initialText,
  onSave,
}: {
  initialText: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(true);  // default open so matrix data is immediately visible
  const [text, setText] = useState(initialText);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      await onSave(text);
      // setOpen(false); // Keep expanded after save per user request
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
      >
        <Braces className="w-3.5 h-3.5" />
        Edit Grid Data (JSON)
        <ChevronDown className="w-3 h-3 text-blue-400" />
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="font-mono text-xs border rounded-md px-2 py-1.5 w-full max-w-md min-h-[90px] resize-y focus:outline-none focus:ring-2 focus:ring-neutral-300 bg-neutral-50"
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending} className="h-7 text-xs">
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} className="h-7 text-xs">
          Collapse
        </Button>
      </div>
    </div>
  );
}

// ─── Response card: free-text (and matrix / multi-select fallback) ────────────

function TextCard({ response }: { response: BulkResponse }) {
  const raw = response.rawExtractedValueJson as any;
  const existing = response.correctedValueJson as any;

  const rawValue = existing?.value ?? raw?.value;
  const isComplex = rawValue !== null && rawValue !== undefined && typeof rawValue !== "string";

  const [text, setText] = useState<string>(
    isComplex ? JSON.stringify(rawValue, null, 2) : (rawValue ?? "")
  );
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      try {
        await saveResponseCorrection(response.id, {
          type: "text",
          value: text,
          corrected: true,
        });
        toast.success("Saved");
      } catch (e: any) {
        toast.error(e.message ?? "Failed to save");
      }
    });

  if (isComplex) {
    return (
      <BulkCollapsibleJsonEditor
        initialText={text}
        onSave={async (t) => {
          let saveValue: any = t;
          try { saveValue = JSON.parse(t); } catch { /* keep string */ }
          try {
            await saveResponseCorrection(response.id, {
              type: "text",
              value: saveValue,
              corrected: true,
            });
            toast.success("Saved");
          } catch (e: any) {
            toast.error(e.message ?? "Failed to save");
          }
        }}
      />
    );
  }

  return (
    <div className="flex gap-2 items-center">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="max-w-xs h-8 text-sm"
        placeholder="Extracted text…"
      />
      <Button size="sm" variant="outline" onClick={save} disabled={pending} className="h-8 text-xs shrink-0">
        {pending ? "…" : "Save"}
      </Button>
    </div>
  );
}

// ─── Single submission card ────────────────────────────────────────────────────

function SubmissionCard({ submission }: { submission: BulkSubmission }) {
  const needsReviewCount = submission.responses.filter((r) => r.needsReview).length;
  const isFinalized = submission.status === "FINALIZED";

  // Default open when there are responses needing review; closed when already clean.
  const [open, setOpen] = useState(needsReviewCount > 0 && !isFinalized);

  const [name, setName] = useState(
    submission.participantNameCorrected ?? submission.participantNameExtracted ?? ""
  );
  const [savingName, setSavingName] = useState(false);

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      await correctParticipantName(submission.id, name);
      toast.success("Name saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div
      className={`bg-white border rounded-lg shadow-sm overflow-hidden ${
        isFinalized ? "border-green-200 opacity-70" : needsReviewCount > 0 ? "border-amber-300" : "border-neutral-200"
      }`}
    >
      {/* Card header */}
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-neutral-50 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-neutral-400">#{submission.participantIndex}</span>
          <span className="font-medium">
            {submission.participantNameCorrected ?? submission.participantNameExtracted ?? "Anonymous"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isFinalized ? (
            <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Finalized
            </span>
          ) : needsReviewCount > 0 ? (
            <span className="flex items-center gap-1 text-amber-600 text-xs font-medium">
              <AlertCircle className="w-3.5 h-3.5" /> {needsReviewCount} needs review
            </span>
          ) : (
            <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ready
            </span>
          )}
          {open ? (
            <ChevronUp className="w-4 h-4 text-neutral-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-neutral-400" />
          )}
        </div>
      </button>

      {/* Card body */}
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t">
          {/* Name editor */}
          <div className="flex items-center gap-2 pt-3">
            <User className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-xs h-8 text-sm"
              placeholder="Participant name…"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveName}
              disabled={savingName}
              className="h-8 text-xs"
            >
              {savingName ? "…" : "Save name"}
            </Button>
          </div>

          {/* Response rows */}
          {submission.responses.map((r) => {
            const raw = r.rawExtractedValueJson as any;
            const fieldType = raw?.type ?? "text";

            return (
              <div
                key={r.id}
                className={`rounded-md border p-3 space-y-2 ${
                  r.needsReview ? "border-amber-200 bg-amber-50/40" : "border-neutral-100"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-500 shrink-0">
                      {r.question.questionNumber}
                    </span>
                    <span className="text-sm font-medium truncate">{r.question.questionText}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.confidenceScore != null && (
                      <span className="text-xs text-neutral-400">
                        {(r.confidenceScore * 100).toFixed(0)}%
                      </span>
                    )}
                    {r.needsReview ? (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    )}
                  </div>
                </div>

                {fieldType === "checkbox" ? (
                  <CheckboxCard response={r} />
                ) : (
                  <TextCard response={r} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Finalize button ───────────────────────────────────────────────────────────

function FinalizeBatchButton({
  batchId,
  surveyId,
}: {
  batchId: string;
  surveyId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const handleFinalize = () =>
    start(async () => {
      try {
        await finalizeBatch(batchId);
        toast.success("Batch finalized and locked!");
        router.push(`/surveys/${surveyId}/batches/${batchId}`);
      } catch (e: any) {
        toast.error(e.message ?? "Failed to finalize batch");
      }
    });

  return (
    <Button
      size="lg"
      onClick={handleFinalize}
      disabled={pending}
      className="bg-green-600 hover:bg-green-700 gap-2"
    >
      <Lock className="w-4 h-4" />
      {pending ? "Finalizing…" : "Finalize & Lock Batch"}
    </Button>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export function BulkReviewClient({
  submissions,
  batchId,
  surveyId,
}: BulkReviewClientProps) {
  const totalNeedsReview = submissions.reduce(
    (acc, s) => acc + s.responses.filter((r) => r.needsReview).length,
    0
  );

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {totalNeedsReview > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            <strong>{totalNeedsReview}</strong> field
            {totalNeedsReview !== 1 ? "s" : ""} still need review across{" "}
            <strong>
              {submissions.filter((s) => s.responses.some((r) => r.needsReview)).length}
            </strong>{" "}
            participant{submissions.filter((s) => s.responses.some((r) => r.needsReview)).length !== 1 ? "s" : ""}. Cards are expanded automatically.
          </span>
        </div>
      )}

      {/* Submission cards */}
      {submissions.map((s) => (
        <SubmissionCard key={s.id} submission={s} />
      ))}

      {/* Sticky footer */}
      <div className="sticky bottom-4 flex justify-end pt-2">
        <div className="bg-white border rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
          <span className="text-sm text-neutral-500">
            {totalNeedsReview > 0 ? (
              <span className="text-amber-600 font-medium">
                {totalNeedsReview} field{totalNeedsReview !== 1 ? "s" : ""} flagged — finalizing will clear all flags.
              </span>
            ) : (
              <span className="text-green-600 font-medium">All responses reviewed ✓</span>
            )}
          </span>
          <FinalizeBatchButton batchId={batchId} surveyId={surveyId} />
        </div>
      </div>
    </div>
  );
}
