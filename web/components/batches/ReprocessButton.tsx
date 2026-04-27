"use client";

import { useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { reprocessSubmission } from "@/_actions/review";
import { toast } from "sonner";

interface ReprocessButtonProps {
  submissionId: string;
  /** When true the submission is stale — highlight the button to prompt action. */
  isStale?: boolean;
  /**
   * The current confidence score. When null the worker has reset this submission
   * for reprocessing but hasn't finished yet — show a spinner so the user knows
   * work is in progress even if they didn't click the button themselves.
   */
  confidenceScore?: number | null;
}

export function ReprocessButton({
  submissionId,
  isStale = false,
  confidenceScore,
}: ReprocessButtonProps) {
  const [pending, start] = useTransition();

  // Worker-in-flight: confidenceScore is reset to NULL while reprocessing.
  const workerBusy = confidenceScore === null;

  const handle = () =>
    start(async () => {
      try {
        await reprocessSubmission(submissionId);
        toast.success(
          isStale
            ? "Re-extracting changed questions — page will update automatically."
            : "Re-extraction queued — page will update automatically in ~30 s."
        );
      } catch (e: any) {
        toast.error(e.message ?? "Failed to queue reprocess");
      }
    });

  if (isStale) {
    return (
      <button
        type="button"
        onClick={handle}
        disabled={pending || workerBusy}
        title={
          workerBusy
            ? "Re-extraction in progress…"
            : "Template questions changed — click to re-extract only the updated questions"
        }
        className={`flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-40
          text-amber-600 hover:text-amber-800
          ${pending || workerBusy ? "" : "animate-pulse"}`}
      >
        {pending || workerBusy ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <RefreshCw className="w-3 h-3" />
        )}
        {pending ? "Queuing…" : workerBusy ? "Extracting…" : "Sync"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending || workerBusy}
      title={workerBusy ? "Re-extraction in progress…" : "Reprocess with AI"}
      className="flex items-center gap-1 text-xs text-neutral-400 hover:text-blue-600 transition-colors disabled:opacity-40"
    >
      {pending || workerBusy ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <RefreshCw className="w-3 h-3" />
      )}
      {pending ? "Queuing…" : workerBusy ? "Extracting…" : "Reprocess"}
    </button>
  );
}
