"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { reprocessSubmission } from "@/_actions/review";
import { toast } from "sonner";

interface ReprocessButtonProps {
  submissionId: string;
  /** When true the submission is stale — highlight the button to prompt action. */
  isStale?: boolean;
}

export function ReprocessButton({ submissionId, isStale = false }: ReprocessButtonProps) {
  const [pending, start] = useTransition();

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
        disabled={pending}
        title="Template questions changed — click to re-extract only the updated questions"
        className={`flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-40
          text-amber-600 hover:text-amber-800
          ${pending ? "" : "animate-pulse"}`}
      >
        <RefreshCw className={`w-3 h-3 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Queuing…" : "Sync"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      title="Reprocess with AI"
      className="flex items-center gap-1 text-xs text-neutral-400 hover:text-blue-600 transition-colors disabled:opacity-40"
    >
      <RefreshCw className={`w-3 h-3 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Queuing…" : "Reprocess"}
    </button>
  );
}
