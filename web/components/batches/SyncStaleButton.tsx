"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncAllStaleSubmissions } from "@/_actions/review";
import { toast } from "sonner";

interface SyncStaleButtonProps {
  batchId: string;
  staleCount: number;
}

export function SyncStaleButton({ batchId, staleCount }: SyncStaleButtonProps) {
  const [pending, start] = useTransition();

  const handle = () =>
    start(async () => {
      try {
        const result = await syncAllStaleSubmissions(batchId);
        toast.success(
          `${result.queued} submission${result.queued !== 1 ? "s" : ""} queued for re-extraction. Only changed questions will be re-processed.`
        );
      } catch (e: any) {
        toast.error(e.message ?? "Failed to sync stale submissions");
      }
    });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handle}
      disabled={pending || staleCount === 0}
      className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 gap-2"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending
        ? "Queuing…"
        : `Sync ${staleCount} Stale Submission${staleCount !== 1 ? "s" : ""}`}
    </Button>
  );
}
