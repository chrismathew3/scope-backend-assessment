"use client";

import type { ImportDetail, ImportRowView } from "@scope/shared";
import { useState } from "react";
import { formatDateTime, primaryButton, secondaryButton } from "~/lib/ui";

interface Props {
  detail: ImportDetail;
  timezone?: string;
  onApply: (confirmLargeArchive: boolean) => void;
  onDiscard: () => void;
  onClose: () => void;
  isApplying: boolean;
  error: string | null;
}

const fieldLabels: Record<string, string> = {
  movieTitle: "Title",
  auditorium: "Auditorium",
  endTime: "End time",
  language: "Language",
  format: "Format",
  rating: "Rating",
  status: "Status",
};

function Section({
  title,
  count,
  tone,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  tone: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  if (count === 0) return null;
  return (
    <details open={defaultOpen} className="group">
      <summary className={`mb-2 cursor-pointer list-none text-sm font-semibold ${tone}`}>
        <span className="mr-1 inline-block transition group-open:rotate-90">›</span>
        {title} ({count})
      </summary>
      <div className="space-y-2">{children}</div>
    </details>
  );
}

function Issues({ row }: { row: ImportRowView }) {
  const items = [
    ...row.errors.map((e) => ({ ...e, kind: "error" })),
    ...row.warnings.map((w) => ({ ...w, kind: "warning" })),
  ];
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {items.map((i, n) => (
        <li key={n} className={i.kind === "error" ? "text-red-300" : "text-amber-300/80"}>
          {i.column !== "*" ? `${i.column}: ` : ""}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function PreviewModal({ detail, timezone, onApply, onDiscard, onClose, isApplying, error }: Props) {
  const { summary, rows, archives } = detail;
  const [confirmLarge, setConfirmLarge] = useState(false);
  const largeArchive = summary.activeBefore > 0 && summary.archiveCount > summary.activeBefore / 2;
  const by = (o: ImportRowView["outcome"]) => rows.filter((r) => r.outcome === o);
  const adds = by("add");
  const updates = by("update");
  const duplicates = by("duplicate");
  const rejected = by("rejected");
  const applied = summary.status === "applied";
  const closed = summary.status !== "previewed";
  const nothingToDo = summary.addCount + summary.updateCount + summary.archiveCount === 0;
  const when = (iso: string | null) => (iso ? formatDateTime(iso, timezone) : "—");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
        <div className="border-b border-gray-700 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">
                {applied ? "Import applied" : closed ? `Import ${summary.status}` : "Review changes"}
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                {summary.filename} → {summary.theaterName} · {summary.totalRows} rows
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-2xl leading-none text-gray-400 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {[
              ["Add", summary.addCount, "bg-green-950/40 text-green-300"],
              ["Update", summary.updateCount, "bg-yellow-950/40 text-yellow-300"],
              ["Archive", summary.archiveCount, "bg-red-950/40 text-red-300"],
              ["Unchanged", summary.unchangedCount, "bg-gray-800 text-gray-300"],
              ["Duplicate", summary.duplicateCount, "bg-gray-800 text-gray-300"],
              ["Rejected", summary.rejectedCount, "bg-red-950/40 text-red-300"],
            ].map(([label, n, cls]) => (
              <span key={label as string} className={`rounded-full px-3 py-1 ${cls as string}`}>
                {label} {n}
              </span>
            ))}
          </div>
          {summary.notices.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-amber-200/90">
              {summary.notices.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {nothingToDo && summary.rejectedCount === 0 && (
            <p className="text-center text-gray-400">The schedule already matches this file. Nothing to change.</p>
          )}
          <Section title="New showtimes" count={adds.length} tone="text-green-400">
            {adds.map((r) => (
              <div key={r.lineNumber} className="rounded-lg border border-green-900 bg-green-950/30 p-3">
                <div className="font-medium text-white">{r.movieTitle}</div>
                <div className="text-sm text-gray-400">
                  {r.auditorium} · {when(r.startTime)} – {when(r.endTime)} · line {r.lineNumber}
                </div>
                <Issues row={r} />
              </div>
            ))}
          </Section>
          <Section title="Updates" count={updates.length} tone="text-yellow-400">
            {updates.map((r) => (
              <div key={r.lineNumber} className="rounded-lg border border-yellow-900 bg-yellow-950/30 p-3">
                <div className="font-medium text-white">
                  {r.movieTitle}
                  {r.matchMethod === "fuzzy_title" && (
                    <span className="ml-2 rounded bg-yellow-900/60 px-1.5 py-0.5 text-xs text-yellow-200">
                      matched by similar title
                    </span>
                  )}
                  {r.matchMethod === "reactivated" && (
                    <span className="ml-2 rounded bg-blue-900/60 px-1.5 py-0.5 text-xs text-blue-200">
                      brought back from archive
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400">
                  {when(r.startTime)} · line {r.lineNumber}
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {r.diffs.map((d) => (
                    <li key={d.field}>
                      <span className="text-gray-400">{fieldLabels[d.field] ?? d.field}: </span>
                      <span className="text-red-300 line-through">{d.oldValue}</span>
                      <span className="mx-2 text-gray-500">→</span>
                      <span className="text-green-300">{d.newValue}</span>
                    </li>
                  ))}
                </ul>
                <Issues row={r} />
              </div>
            ))}
          </Section>
          <Section title="Will be archived (missing from this file)" count={archives.length} tone="text-red-400">
            {archives.map((a) => (
              <div key={a.showtimeId} className="rounded-lg border border-red-900 bg-red-950/30 p-3">
                <div className="font-medium text-white">{a.movieTitle}</div>
                <div className="text-sm text-gray-400">
                  {a.auditorium} · {when(a.startTime)} – {when(a.endTime)}
                </div>
              </div>
            ))}
          </Section>
          <Section title="Rejected rows (not imported)" count={rejected.length} tone="text-red-400">
            {rejected.map((r) => (
              <div key={r.lineNumber} className="rounded-lg border border-gray-700 p-3 text-sm">
                <div className="text-gray-300">
                  Line {r.lineNumber}: {r.raw.movie_title ?? Object.values(r.raw).join(", ")}
                </div>
                <Issues row={r} />
              </div>
            ))}
          </Section>
          <Section
            title="Duplicates in the file (skipped)"
            count={duplicates.length}
            tone="text-gray-400"
            defaultOpen={false}
          >
            {duplicates.map((r) => (
              <div key={r.lineNumber} className="rounded-lg border border-gray-700 p-3 text-sm">
                <div className="text-gray-300">
                  Line {r.lineNumber}: {r.movieTitle} · {when(r.startTime)}
                </div>
                <Issues row={r} />
              </div>
            ))}
          </Section>
        </div>

        <div className="border-t border-gray-700 p-6">
          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
          {!closed && largeArchive && (
            <label className="mb-3 flex items-center gap-2 text-sm text-amber-200">
              <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />I
              understand this archives {summary.archiveCount} of {summary.activeBefore} active showtimes.
            </label>
          )}
          <div className="flex justify-end gap-3">
            {closed ? (
              <button onClick={onClose} className={primaryButton}>
                Done
              </button>
            ) : (
              <>
                <button onClick={onDiscard} disabled={isApplying} className={secondaryButton}>
                  Discard
                </button>
                <button
                  onClick={() => onApply(confirmLarge)}
                  disabled={
                    isApplying || (largeArchive && !confirmLarge) || (nothingToDo && summary.unchangedCount === 0)
                  }
                  className={primaryButton}
                >
                  {isApplying ? "Applying…" : "Apply changes"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
