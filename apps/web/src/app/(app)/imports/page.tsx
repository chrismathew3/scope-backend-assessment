"use client";

import type { ImportSummary } from "@scope/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { button, column, h1, plural, relativeTime } from "~/lib/ui";
import { useShell } from "../../_components/AppShell";

const statusWord: Record<ImportSummary["status"], string> = {
  previewed: "Waiting for review",
  applied: "Applied",
  discarded: "Discarded",
  stale: "Out of date",
};

export default function ImportsPage() {
  const trpc = useTRPC();
  const { me, theaters, selected, setTheaterId } = useShell();
  const adminTheaters = theaters.filter((t) => me.theaterRoles[t.id] === "admin");
  const theater = selected && me.theaterRoles[selected.id] === "admin" ? selected : undefined;
  const list = useQuery({ ...trpc.imports.list.queryOptions({ theaterId: theater?.id ?? "" }), enabled: !!theater });

  return (
    <div className={`${column} pt-8 pb-24`}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className={h1}>Imports</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            {theater ? theater.name : "Partner CSV drops and what was done with them"}
          </p>
        </div>
        {theater && (
          <Link href="/imports/new" className={button.primary}>
            Import CSV
          </Link>
        )}
      </div>

      {!theater ? (
        <div className="mt-10">
          <p className="text-ink-2">Choose one of the theaters you administer.</p>
          <ul className="mt-3 border-t border-line">
            {adminTheaters.map((t) => (
              <li key={t.id} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => setTheaterId(t.id)}
                  className="w-full py-3 text-left font-medium hover:underline hover:decoration-line-strong"
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : list.error ? (
        <p className="mt-8 text-[13px] text-remove">{errorMessage(list.error)}</p>
      ) : list.isPending ? (
        <p className="mt-8 text-[13px] text-ink-3">Loading…</p>
      ) : list.data?.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="font-medium">No imports yet</p>
          <p className="mt-1 text-[13px] text-ink-2">
            Upload a partner CSV and the agent will propose changes for you to review.
          </p>
        </div>
      ) : (
        <ul className="mt-8 border-t border-line">
          {(list.data ?? []).map((imp) => {
            const changes = imp.addCount + imp.updateCount + imp.archiveCount;
            return (
              <li key={imp.id} className="border-b border-line">
                <Link href={`/imports/${imp.id}`} className="group flex items-baseline gap-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium group-hover:underline group-hover:decoration-line-strong">
                      {imp.filename}
                    </p>
                    <p className="text-[13px] text-ink-2">
                      {/* Once applied, the counts are what was applied, not what was proposed. */}
                      {imp.status === "applied"
                        ? `${plural(changes, "change")} applied`
                        : plural(changes, "proposed change")}
                      , {plural(imp.totalRows, "row")} · {imp.uploadedBy}, {relativeTime(imp.createdAt)}
                      {imp.agent.status !== "ok" ? " · rules only" : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[13px] ${imp.status === "previewed" ? "font-medium text-ink" : "text-ink-2"}`}
                  >
                    {statusWord[imp.status]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
