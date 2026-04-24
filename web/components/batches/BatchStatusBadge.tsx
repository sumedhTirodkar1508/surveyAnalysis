import { BatchStatus } from "@prisma/client";

const statusConfig: Record<BatchStatus, { label: string; className: string }> = {
  UPLOADED: { label: "Uploaded", className: "bg-blue-100 text-blue-800" },
  PROCESSING: { label: "Processing", className: "bg-amber-100 text-amber-800" },
  NEEDS_REVIEW: { label: "Needs Review", className: "bg-yellow-100 text-yellow-800" },
  FINALIZED: { label: "Finalized", className: "bg-green-100 text-green-800" },
  FAILED: { label: "Failed", className: "bg-red-100 text-red-800" },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const config = statusConfig[status] ?? { label: status, className: "bg-neutral-100 text-neutral-800" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
