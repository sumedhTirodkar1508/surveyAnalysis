"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible component that refreshes the page every 5 seconds while
 * the analysis is QUEUED or PROCESSING. The server component will re-render
 * once the status changes to COMPLETE / FAILED and this component will unmount.
 */
export function AnalysisPoller({ batchId }: { batchId: string }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [batchId, router]);

  return null;
}
