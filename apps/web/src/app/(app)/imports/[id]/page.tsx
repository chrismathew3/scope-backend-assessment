"use client";

import { type ImportDetail, type ImportRowView, isLargeArchive } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, httpStatusOf, useTRPC } from "~/lib/trpc";
import { button, column, formatWeekdayTime, h1, lede as ledeClass, plural } from "~/lib/ui";
import { useShell } from "../../../_components/AppShell";
import { ChangeRow } from "./_components/ChangeRow";
import { QuietRow } from "./_components/QuietRow";
import { useReviewKeyboard } from "./_components/useReviewKeyboard";
import { type Item, modelName } from "./_components/wording";

/** New showtimes past this many collapse behind "Show all". */
const ADD_PREVIEW = 10;

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { theaters } = useShell();
  const detail = useQuery(trpc.imports.get.queryOptions({ id }));

  if (detail.isPending) {
    return (
      <div className={`${column} pt-8`}>
        <div className="h-9 w-80 animate-pulse rounded bg-wash" />
        <div className="mt-3 h-4 w-96 animate-pulse rounded bg-wash" />
        <div className="mt-10 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-wash" />
          ))}
        </div>
      </div>
    );
  }
  if (detail.error) {
    return (
      <div className={`${column} pt-8`}>
        <h1 className={h1}>
          {httpStatusOf(detail.error) === 404 ? "This import isn't available" : "Couldn't load this import"}
        </h1>
        <p className="mt-2 text-ink-2">
          {httpStatusOf(detail.error) === 404
            ? "It may belong to a theater you don't administer, or the demo data was reset."
            : errorMessage(detail.error)}
        </p>
        <Link href="/imports/new" className={`${button.secondary} mt-6`}>
          Start a new import
        </Link>
      </div>
    );
  }
  const tz = theaters.find((t) => t.id === detail.data.summary.theaterId)?.timezone;
  return <Review detail={detail.data} timezone={tz} />;
}

function Review({ detail, timezone }: { detail: ImportDetail; timezone?: string }) {
  const trpc = useTRPC();
  const { setTheaterId, notify } = useShell();
  // Open on the import's theater once; switching away afterwards is the user's choice.
  useEffect(() => {
    setTheaterId(detail.summary.theaterId);
  }, [detail.summary.theaterId, setTheaterId]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { summary, rows, archives } = detail;
  const agent = summary.agent;
  const open = summary.status === "previewed";

  // Actionable items, riskiest first: changes to existing showtimes, then removals, then new showtimes.
  const items = useMemo<Item[]>(() => {
    const asItem = (row: ImportRowView): Item => ({ kind: "row", key: `r${row.lineNumber}`, row });
    const updates = rows.filter((r) => r.outcome === "update").map(asItem);
    const adds = rows.filter((r) => r.outcome === "add").map(asItem);
    const removals = archives.map<Item>((archive) => ({ kind: "archive", key: `a${archive.showtimeId}`, archive }));
    return [...updates, ...removals, ...adds];
  }, [rows, archives]);
  const unchanged = rows.filter((r) => r.outcome === "unchanged");
  const duplicates = rows.filter((r) => r.outcome === "duplicate");
  const rejected = rows.filter((r) => r.outcome === "rejected");

  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.key, i.kind === "row" ? i.row.accepted : i.archive.accepted])),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [showAllAdds, setShowAllAdds] = useState(false);

  // Adds come last, so collapsing them is a slice off the end.
  const addKeys = items.filter((i) => i.kind === "row" && i.row.outcome === "add").map((i) => i.key);
  const hiddenAdds = showAllAdds ? 0 : Math.max(0, addKeys.length - ADD_PREVIEW);
  const shown = useMemo(() => items.slice(0, items.length - hiddenAdds), [items, hiddenAdds]);
  const shownKeys = useMemo(() => shown.map((i) => i.key), [shown]);
  const allAddsOn = addKeys.every((k) => accepted[k]);

  const approvedCount = items.filter((i) => accepted[i.key]).length;
  const approvedArchives = items.filter((i) => i.kind === "archive" && accepted[i.key]).length;
  const largeArchive = isLargeArchive(approvedArchives, summary.activeBefore);
  const nothingToDo = items.length === 0;

  const toggle = useCallback((key: string) => open && setAccepted((a) => ({ ...a, [key]: !a[key] })), [open]);
  const expand = useCallback((key: string) => setExpanded((x) => (x === key ? null : key)), []);

  const commit = useMutation(
    trpc.imports.commit.mutationOptions({
      onSuccess: async (d) => {
        queryClient.setQueryData(trpc.imports.get.queryKey({ id: d.summary.id }), d);
        await queryClient.invalidateQueries({ queryKey: trpc.showtimes.pathKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.imports.list.pathKey() });
        notify("Schedule updated.");
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
    }),
  );
  const discard = useMutation(
    trpc.imports.discard.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.imports.list.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.imports.get.queryKey({ id: summary.id }) });
        notify("Import discarded. Nothing changed.");
        router.push("/");
      },
      onError: (e) => notify(errorMessage(e), "error"),
    }),
  );

  const apply = useCallback(() => {
    if (
      !open ||
      approvedCount === 0 ||
      commit.isPending ||
      httpStatusOf(commit.error) === 409 ||
      (largeArchive && !confirmLarge)
    )
      return;
    commit.mutate({
      id: summary.id,
      confirmLargeArchive: confirmLarge,
      decisions: {
        rows: items.flatMap((i) =>
          i.kind === "row" ? [{ lineNumber: i.row.lineNumber, accepted: !!accepted[i.key] }] : [],
        ),
        archives: items.flatMap((i) =>
          i.kind === "archive" ? [{ showtimeId: i.archive.showtimeId, accepted: !!accepted[i.key] }] : [],
        ),
      },
    });
  }, [open, approvedCount, commit, largeArchive, confirmLarge, summary.id, items, accepted]);

  const rowRefs = useReviewKeyboard({
    enabled: open,
    keys: shownKeys,
    onToggle: toggle,
    onExpand: expand,
    onApply: apply,
  });

  const applied = summary.status === "applied";
  // The server refused because the schedule moved on (or the preview expired): re-upload is the only way forward.
  const staleNow = httpStatusOf(commit.error) === 409;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const rejectedByYou = applied
    ? items.filter((i) => !(i.kind === "row" ? i.row.accepted : i.archive.accepted)).length
    : 0;

  const title = applied
    ? `Applied ${summary.filename}`
    : summary.status === "discarded"
      ? `Discarded ${summary.filename}`
      : `Review ${summary.filename}`;

  const lede = (() => {
    if (summary.status === "stale")
      return "The schedule changed after this preview was made, so it can't be applied. Upload the file again to review against the current schedule.";
    if (summary.status === "discarded") return "Nothing from this file was applied.";
    if (applied)
      return `${plural(items.length - rejectedByYou, "change")} applied to ${summary.theaterName}${rejectedByYou ? `, ${rejectedByYou} left as ${rejectedByYou === 1 ? "it was" : "they were"}` : ""}.`;
    const need = items.length === 0 ? "" : ` ${plural(items.length, "change needs", "changes need")} your approval.`;
    return `${plural(summary.totalRows, "row")} compared with your schedule.${need}`;
  })();

  return (
    <div className={`${column} pt-8 ${open ? "pb-40" : "pb-24"}`}>
      <h1 key={summary.status} className={`${h1} settle break-words`}>
        {title}
      </h1>
      <p key={`l-${summary.status}`} className={`${ledeClass} settle`}>
        {lede}
      </p>

      {agent.status !== "ok" && (
        <p className="mt-5 border-l-2 border-risk pl-3 text-[13px] text-ink-2">
          {agent.status === "off" ? "No AI model is configured" : "The agent couldn't finish"}
          {agent.error ? ` (${agent.error})` : ""}, so every proposal below comes from the matching rules. Review them
          as usual.
        </p>
      )}
      {summary.notices.length > 0 && open && (
        <ul className="mt-5 space-y-1 text-[13px] text-ink-2">
          {summary.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {/* Proposed changes */}
      {nothingToDo ? (
        <p className="mt-10 border-t border-line pt-6 text-ink-2">
          The schedule already matches this file. There&apos;s nothing to apply.
        </p>
      ) : (
        <div role="list" aria-label="Proposed changes" className="mt-9 border-t border-line">
          {shown.map((it, idx) => (
            <ChangeRow
              key={it.key}
              item={it}
              ref={(el) => {
                rowRefs.current[idx] = el;
              }}
              accepted={!!accepted[it.key]}
              open={open}
              expanded={expanded === it.key}
              onToggle={() => toggle(it.key)}
              onExpand={() => expand(it.key)}
              timezone={timezone}
              applied={applied}
            />
          ))}
          {hiddenAdds > 0 && (
            <div
              role="listitem"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3.5 text-[13px]"
            >
              <span className="text-ink-2">{plural(hiddenAdds, "more new showtime")}</span>
              <button type="button" className={button.link} onClick={() => setShowAllAdds(true)}>
                Show all
              </button>
              {open && (
                <button
                  type="button"
                  className={button.link}
                  onClick={() =>
                    setAccepted((a) => ({ ...a, ...Object.fromEntries(addKeys.map((k) => [k, !allAddsOn])) }))
                  }
                >
                  {allAddsOn ? "Untick all new showtimes" : "Tick all new showtimes"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* The rest, quietly: same list, dimmed, nothing to approve */}
      {(duplicates.length > 0 || unchanged.length > 0 || rejected.length > 0) && (
        <ul aria-label="Rows that need nothing" className={nothingToDo ? "mt-6 border-t border-line" : ""}>
          {duplicates.map((r) => (
            <QuietRow
              key={r.lineNumber}
              title={`Duplicate of line ${r.duplicateOf ?? "?"}${r.movieTitle ? `: ${r.movieTitle}` : ""}`}
              when={r.startTime ? formatWeekdayTime(r.startTime, timezone) : ""}
              text={`Skipped. ${r.explanation ?? "Same film and start time as an earlier row."}`}
            />
          ))}
          {unchanged.map((r) => (
            <QuietRow
              key={r.lineNumber}
              title={r.movieTitle ?? "Showtime"}
              when={r.startTime ? formatWeekdayTime(r.startTime, timezone) : ""}
              text={`Already matches. ${r.explanation ?? ""}`}
            />
          ))}
          {rejected.map((r) => (
            <QuietRow
              key={r.lineNumber}
              tone="error"
              title={`Line ${r.lineNumber} can't be imported`}
              when={r.movieTitle ?? r.raw.movie_title ?? ""}
              text={r.errors.map((e) => e.message).join(" ")}
            />
          ))}
        </ul>
      )}

      {agent.trace.length > 0 && (
        <details className="group mt-10">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
            <ChevronRight aria-hidden className="size-3.5 transition-transform duration-150 group-open:rotate-90" />
            How the agent decided
          </summary>
          <ol className="mt-3 space-y-2 border-l border-line pl-4">
            <li className="text-[13px]">
              <span className="text-ink">
                {agent.status !== "ok"
                  ? "Rules only, no agent run"
                  : agent.durationMs === null
                    ? "Rules only, no agent call needed"
                    : rows.some((r) => r.decisionSource === "ai")
                      ? `Reviewed by ${modelName(agent.model)} in ${(agent.durationMs / 1000).toFixed(1)}s`
                      : `Checked by ${modelName(agent.model)}; the rules settled every row`}
              </span>
              {agent.summary && <span className="block text-ink-2">{agent.summary}</span>}
              {agent.overrides > 0 && (
                <span className="block text-ink-2">
                  {plural(agent.overrides, "match", "matches")} the matching rules alone would have missed.
                </span>
              )}
            </li>
            {agent.trace
              .filter((s) => s.kind !== "submit")
              .map((s, i) => (
                <li key={i} className="text-[13px]">
                  <span className="text-ink">{s.label}</span>
                  {s.detail && <span className="block text-ink-2">{s.detail}</span>}
                </li>
              ))}
            <li className="text-[13px] text-ink">
              Proposed {plural(items.length, "change")}; every proposal was checked against the stored schedule
              {agent.corrections > 0
                ? `, and ${plural(agent.corrections, "call was", "calls were")} replaced by the rules`
                : ""}
              .
            </li>
          </ol>
        </details>
      )}

      {applied && (
        <div className="mt-10 flex gap-2">
          <Link href="/" className={button.primary}>
            View schedule
          </Link>
          <Link href="/imports/new" className={button.secondary}>
            Import another file
          </Link>
        </div>
      )}
      {summary.status === "stale" && (
        <Link href="/imports/new" className={`${button.primary} mt-8`}>
          Upload again
        </Link>
      )}

      {open && nothingToDo && (
        <div className="mt-8 flex items-center gap-4">
          <Link href="/" className={button.primary}>
            Back to schedule
          </Link>
          <button
            type="button"
            className={button.link}
            disabled={discard.isPending}
            onClick={() => discard.mutate({ id: summary.id })}
          >
            Discard this import
          </button>
        </div>
      )}

      {/* Sticky footer */}
      {open && !nothingToDo && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 supports-[backdrop-filter]:bg-white/85 supports-[backdrop-filter]:backdrop-blur">
          <div className={`${column} flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5`}>
            {largeArchive ? (
              <label className="flex items-center gap-2 text-[13px] text-risk">
                <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
                Archive {approvedArchives} of {summary.activeBefore} active showtimes
              </label>
            ) : (
              <span className="hidden text-[13px] text-ink-3 sm:inline">
                {approvedCount} of {items.length} approved. Space to toggle, {isMac ? "Cmd" : "Ctrl"}+Enter to apply
              </span>
            )}
            {commit.error && (
              <span className="w-full text-[13px] text-remove sm:order-last">{errorMessage(commit.error)}</span>
            )}
            <div className="ml-auto flex items-center gap-4">
              {staleNow ? (
                <Link href="/imports/new" className={`${button.primary} h-10 px-5`}>
                  Upload again
                </Link>
              ) : (
                <button
                  type="button"
                  className={`${button.primary} h-10 px-5`}
                  disabled={commit.isPending || approvedCount === 0 || (largeArchive && !confirmLarge)}
                  onClick={apply}
                >
                  {commit.isPending
                    ? "Applying…"
                    : approvedCount === 0
                      ? "Nothing selected"
                      : `Apply ${plural(approvedCount, "change")}`}
                </button>
              )}
              <button
                type="button"
                className={button.link}
                disabled={discard.isPending || commit.isPending}
                onClick={() => discard.mutate({ id: summary.id })}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
