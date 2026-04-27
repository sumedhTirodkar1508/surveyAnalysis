"use client";

import { PencilLine } from "lucide-react";

/**
 * Animated banner shown at the top of the Template page whenever the active
 * version has been returned to draft.  It reminds the researcher that saving
 * question changes will mark any already-extracted submissions as stale.
 */
export function DraftModeBanner() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-amber-300 bg-amber-50 px-5 py-3.5 flex items-center gap-3">
      {/* Animated left-edge accent */}
      <span
        className="absolute left-0 inset-y-0 w-1 rounded-l-lg bg-amber-400"
        style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
      />
      <PencilLine className="w-4 h-4 text-amber-600 shrink-0 ml-1" />
      <div className="text-sm">
        <span className="font-semibold text-amber-900">Draft Mode — </span>
        <span className="text-amber-800">
          Questions can be freely edited. Saving a change to{" "}
          <strong>question type</strong> or <strong>options</strong> will
          automatically mark existing extractions as{" "}
          <strong>Stale</strong> so they can be re-synced.
        </span>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
