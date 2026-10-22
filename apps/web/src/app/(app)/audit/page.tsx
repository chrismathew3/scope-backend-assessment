"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { formatDateTime, inputClass, panelClass } from "~/lib/ui";
import { useMe } from "../../_components/AppShell";

/** Short, readable description of a before/after pair. */
function describe(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
    parts.push(key in b ? `${key}: ${show(b[key])} → ${show(a[key])}` : `${key}: ${show(a[key])}`);
  }
  return parts.join(" · ");
}

export default function AuditPage() {
  const trpc = useTRPC();
  const me = useMe();
  const [theaterId, setTheaterId] = useState("");
  const theaters = useQuery(trpc.theaters.list.queryOptions());
  const adminTheaters = (theaters.data ?? []).filter((t) => t.myRole === "admin");
  const log = useQuery(trpc.audit.list.queryOptions({ theaterId: theaterId || undefined, limit: 100 }));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Audit log</h1>
          <p className="text-gray-400">
            Every change, who made it, and when. Entries can&apos;t be edited or deleted.
            {!me.isSuperAdmin && " You see changes in theaters you administer."}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Theater</span>
          <select value={theaterId} onChange={(e) => setTheaterId(e.target.value)} className={`${inputClass} min-w-52`}>
            <option value="">{me.isSuperAdmin ? "Everything" : "All my theaters"}</option>
            {adminTheaters.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={`${panelClass} overflow-x-auto`}>
        {log.error && <p className="p-4 text-sm text-red-400">{errorMessage(log.error)}</p>}
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800 text-xs text-gray-400 uppercase">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">What changed</th>
            </tr>
          </thead>
          <tbody>
            {(log.data ?? []).map((e) => (
              <tr key={e.id} className="border-b border-gray-800 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-gray-400">{formatDateTime(e.createdAt)}</td>
                <td className="px-4 py-3 text-gray-200">{e.actorName ?? "—"}</td>
                <td className="px-4 py-3">
                  <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-purple-200">{e.action}</code>
                  <div className="mt-1 text-xs text-gray-500">
                    {e.entityType} {e.entityId.slice(0, 18)}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-300">{describe(e.before, e.after) || "—"}</td>
              </tr>
            ))}
            {log.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No changes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
