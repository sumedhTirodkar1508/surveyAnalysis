import { SurveySubmission, SubmissionStatus } from "@prisma/client";
import Link from "next/link";

const submissionStatusConfig: Record<SubmissionStatus, { label: string; className: string }> = {
  EXTRACTED: { label: "Extracted", className: "bg-blue-100 text-blue-800" },
  NEEDS_REVIEW: { label: "Needs Review", className: "bg-yellow-100 text-yellow-800" },
  REVIEWED: { label: "Reviewed", className: "bg-purple-100 text-purple-800" },
  FINALIZED: { label: "Finalized", className: "bg-green-100 text-green-800" },
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
            return (
              <tr key={s.id} className="hover:bg-neutral-50 transition-colors">
                <td className="px-6 py-4 font-mono text-xs text-neutral-500">
                  {s.participantIndex}
                </td>
                <td className="px-6 py-4 font-medium">
                  {s.participantNameCorrected || s.participantNameExtracted || (
                    <span className="text-neutral-400 italic">Unknown</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.className}`}>
                    {statusConfig.label}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {s.confidenceScore != null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.confidenceScore > 0.85 ? "bg-green-500" :
                            s.confidenceScore > 0.6 ? "bg-yellow-500" : "bg-red-500"
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
