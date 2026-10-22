"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { column, formatDateTime, h1, plural, selectField } from "~/lib/ui";
import { useShell } from "../../_components/AppShell";

const actionText: Record<string, string> = {
  "showtime.update": "changed a showtime",
  "schedule.archive_all": "cleared the schedule",
  "import.preview": "uploaded a CSV for review",
  "import.apply": "applied an import",
  "import.discard": "discarded an import",
  "user.create": "added a person",
  "user.update": "changed super admin access",
  "user.deactivate": "deactivated a person",
  "user.reactivate": "reactivated a person",
  "user.password_reset": "reset a password",
  "user.password_change": "changed their password",
  "membership.set": "changed theater access",
  "membership.remove": "removed theater access",
  "theater.create": "added a theater",
  "theater.update": "renamed a theater",
  "theater.archive": "archived a theater",
  "demo.reset": "reset the demo data",
};

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const label: Record<string, string> = {
  movieStatus: "movie status",
  status: "status",
  isSuperAdmin: "super admin",
  role: "role",
  name: "name",
};
const pretty = (v: unknown) =>
  v === true ? "yes" : v === false ? "no" : typeof v === "string" ? v.replace(/-/g, " ") : JSON.stringify(v);

/** One readable sentence per audit entry; internals (model ids, zero counts) stay out. */
function describe(action: string, before: unknown, after: unknown): string {
  const b = (before ?? {}) as Json;
  const a = (after ?? {}) as Json;
  if (action === "import.preview") {
    const parts = [
      num(a.update) && plural(num(a.update), "update"),
      num(a.add) && plural(num(a.add), "new showtime"),
      num(a.archive) && plural(num(a.archive), "archive"),
    ].filter(Boolean);
    return `${str(a.filename)}: ${parts.length ? parts.join(", ") : "no changes"} proposed.`;
  }
  if (action === "import.apply") {
    const approved = num(a.approvedChanges) + num(a.archived);
    const rejected = num(a.rejectedChanges) + num(a.keptMissing);
    return `${str(a.filename)}: ${plural(approved, "change")} applied${rejected ? `, ${rejected} left as ${rejected === 1 ? "it was" : "they were"}` : ""}.`;
  }
  if (action === "schedule.archive_all") return `${plural(num(a.archived), "showtime")} archived.`;
  if (action === "user.create") return `${str(a.email)}${a.isSuperAdmin ? ", as super admin" : ""}.`;
  if (action === "demo.reset") return "Seeded schedule restored and imports cleared.";
  const parts: string[] = [];
  for (const key of Object.keys(a)) {
    if (a[key] === undefined || JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const name = label[key] ?? key;
    parts.push(
      key in b && b[key] != null ? `${name} from ${pretty(b[key])} to ${pretty(a[key])}` : `${name} ${pretty(a[key])}`,
    );
  }
  return parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "";
}

export default function AuditPage() {
  const trpc = useTRPC();
  const { me, theaters } = useShell();
  const [theaterId, setTheaterId] = useState("");
  const adminTheaters = theaters.filter((t) => me.theaterRoles[t.id] === "admin");
  const log = useQuery(trpc.audit.list.queryOptions({ theaterId: theaterId || undefined, limit: 100 }));
  const names = Object.fromEntries(theaters.map((t) => [t.id, t.name]));

  return (
    <div className={`${column} pt-8 pb-24`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={h1}>Audit log</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            Every change, who made it and when. Entries can&apos;t be edited or deleted.
          </p>
        </div>
        <select
          aria-label="Filter by theater"
          value={theaterId}
          onChange={(e) => setTheaterId(e.target.value)}
          className={`${selectField} !w-48 shrink-0`}
        >
          <option value="">{me.isSuperAdmin ? "Everything" : "All my theaters"}</option>
          {adminTheaters.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {log.error && <p className="mt-6 text-[13px] text-remove">{errorMessage(log.error)}</p>}
      <ul className="mt-8 border-t border-line">
        {(log.data ?? []).map((e) => {
          const detail = describe(e.action, e.before, e.after);
          return (
            <li
              key={e.id}
              className="grid grid-cols-1 gap-x-6 border-b border-line py-3 text-[13px] sm:grid-cols-[150px_1fr]"
            >
              <span className="tnum text-ink-2">{formatDateTime(e.createdAt)}</span>
              <div className="min-w-0">
                <p>
                  <span className="font-medium">{e.actorName ?? "System"}</span> {actionText[e.action] ?? e.action}
                  {e.theaterId && names[e.theaterId] ? (
                    <span className="text-ink-2"> at {names[e.theaterId]}</span>
                  ) : null}
                </p>
                {detail && <p className="mt-0.5 break-words text-ink-2">{detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {log.data?.length === 0 && <p className="py-10 text-center text-[13px] text-ink-2">No changes yet.</p>}
    </div>
  );
}
