"use client";

/**
 * Invisible background poller.
 *
 * Starts polling when EITHER:
 *   • initialStatus === "PROCESSING"  — whole-batch extraction in progress
 *   • hasNullScores === true          — at least one submission was just
 *                                       reprocessed (confidenceScore reset to NULL)
 *
 * Calls router.refresh() whenever anything meaningful changes (batch status
 * or the pending-reprocess count). Stops polling once the batch is no longer
 * PROCESSING and no submissions have a null confidenceScore.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBatchProcessingState } from "@/_actions/batches";

interface BatchPollerProps {
  batchId: string;
  initialStatus: string;
  /** True when ≥1 submission in this batch has confidenceScore = NULL,
   *  indicating a reprocess job is in flight. */
  hasNullScores: boolean;
}

const POLL_INTERVAL_MS = 3_000;

export function BatchPoller({ batchId, initialStatus, hasNullScores }: BatchPollerProps) {
  const router = useRouter();

  useEffect(() => {
    // Only poll if there is active work happening.
    const shouldPoll = initialStatus === "PROCESSING" || hasNullScores;
    if (!shouldPoll) return;

    // Track the last known state so we can detect any change.
    let prevStatus = initialStatus;
    let prevPendingCount = hasNullScores ? -1 : 0; // Use -1 to force first poll update if we don't know the exact count

    const interval = setInterval(async () => {
      try {
        const { status, pendingCount } = await getBatchProcessingState(batchId);

        // Detect progress: status change OR a decrease in pending submissions.
        const statusChanged = status !== prevStatus;
        const progressMade = pendingCount < prevPendingCount && prevPendingCount !== -1;

        if (statusChanged || progressMade) {
          prevStatus = status;
          prevPendingCount = pendingCount;
          
          // Use a full reload to guarantee every RSC and client component is synced.
          window.location.reload();

          // If we reached the end, clear the interval.
          if (status !== "PROCESSING" && pendingCount === 0) {
            clearInterval(interval);
          }
        } else if (prevPendingCount === -1) {
          // Initial poll to set baseline count without reloading
          prevPendingCount = pendingCount;
        }
      } catch {
        // Network hiccup — keep polling, don't crash.
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [batchId, router]); // Removed initialStatus and hasNullScores from dependencies to prevent accidental resets

  // Renders nothing — side-effects only.
  return null;
}
