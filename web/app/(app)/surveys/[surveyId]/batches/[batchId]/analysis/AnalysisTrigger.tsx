"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { triggerBatchAnalysis } from "@/_actions/batches";

interface Props {
  batchId: string;
  label?: string;
}

export function AnalysisTrigger({ batchId, label = "Generate Report" }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await triggerBatchAnalysis(batchId);
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to start analysis");
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        onClick={handleClick}
        disabled={isPending}
        className="bg-violet-600 hover:bg-violet-700 gap-2"
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
        {isPending ? "Starting…" : label}
      </Button>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
