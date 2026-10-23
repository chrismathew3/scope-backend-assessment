import { auditLog } from "../db/schema";
import type { AuthedContext } from "../trpc/init";

export interface AuditEvent {
  action: string; // e.g. "showtime.update", "membership.set"
  entityType: string;
  entityId: string;
  theaterId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Written in the request's transaction, so it commits or rolls back with the change. */
export async function audit(ctx: AuthedContext, event: AuditEvent) {
  await ctx.tx.insert(auditLog).values({
    actorId: ctx.user.id,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    theaterId: event.theaterId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    ipAddress: ctx.ip,
    requestId: ctx.requestId,
  });
}
