import { SurveySubmission, SubmissionStatus } from "@prisma/client";
import Link from "next/link";
import { ReprocessButton } from "./ReprocessButton";
import { AlertTriangle } from "lucide-react";

const submissionStatusConfig: Record<SubmissionStatus, { label: string; className: string }> = {
  EXTRACTED:    { label: "Extracted",    className: "bg-blue-100 text-blue-800"    },
  NEEDS_REVIEW: { label: "Needs Review", className: "bg-yellow-100 text-yellow-800" },
  REVIEWED:     { label: "Reviewed",     className: "bg-purple-100 text-purple-800" },
  FINALIZED:    { label: "Finalized",    className: "bg-green-100 text-green-800"   },
};

interface SubmissionsTableProps {
  submissions: SurveySubmission[];
  surveyId: string;
  batchId: string;
}

export function SubmissionsTable({ submissions, surveyId, batchId }: SubmissionsTableProps) {
  if (submissions.length === 0) {
    return (
      <div className="p-8 text-center text-neutral-500">
        No submissions yet. The worker will create them once extraction starts.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b">
          <tr>
            <th className="text-left px-6 py-3 font-medium text-neutral-500">#</th>
            <th className="text-left px-6 py-3 font-medium text-neutral-500">Participant</th>
            <th className="text-left px-6 py-3 font-medium text-neutral-500">Status</th>
            <th className="text-left px-6 py-3 font-medium text-neutral-500">Confidence</th>
            <th className="text-left px-6 py-3 font-medium text-neutral-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {submissions.map((s) => {
            const statusConfig = submissionStatusConfig[s.status];
            const displayName = s.participantNameExtracted ?? "Anonymous";
            const isStale = (s as any).isStale === true;

            return (
              <tr
                key={s.id}
                className={`hover:bg-neutral-50 transition-colors ${isStale ? "bg-amber-50/40" : ""}`}
              >
                <td className="px-6 py-4 font-mono text-xs text-neutral-500">
                  {s.participantIndex}
                </td>

                <td className="px-6 py-4 font-medium">
                  <div className="flex items-center gap-2">
                    {displayName}
                    {isStale && (
                      <span
                        title="Template was updated since this submission was extracted. Use Reprocess to update."
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Stale
                      </span>
                    )}
                  </div>
                </td>

                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.className}`}
                  >
                    {statusConfig.label}
                  </span>
                </td>

                <td className="px-6 py-4">
                  {s.confidenceScore != null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.confidenceScore > 0.85
                              ? "bg-green-500"
                              : s.confidenceScore > 0.6
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${s.confidenceScore * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-neutral-500">
                        {(s.confidenceScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-neutral-400 text-xs">—</span>
                  )}
                </td>

                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {["NEEDS_REVIEW", "EXTRACTED"].includes(s.status) ? (
                      <Link
                        href={`/surveys/${surveyId}/batches/${batchId}/review/${s.id}`}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Review
                      </Link>
                    ) : (
                      <Link
                        href={`/surveys/${surveyId}/batches/${batchId}/review/${s.id}`}
                        className="text-neutral-500 hover:underline text-xs"
                      >
                        View
                      </Link>
                    )}
                    {/* Don't allow reprocess on finalized submissions */}
                    {s.status !== "FINALIZED" && (
                      <ReprocessButton
                        submissionId={s.id}
                        isStale={isStale}
                        confidenceScore={s.confidenceScore}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
