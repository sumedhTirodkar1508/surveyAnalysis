import { prisma } from "@/lib/db";

/**
 * Log an audit event. Designed to be called from Server Actions.
 * Does not throw on failure — audit failures are non-blocking.
 */
export async function auditLog(opts: {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: opts.userId,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        metadataJson: opts.metadata,
      },
    });
  } catch (err) {
    // Non-blocking: log to console but don't propagate
    console.error("[AuditLog] Failed to write audit log:", err);
  }
}
