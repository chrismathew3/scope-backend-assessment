"use client";

import type { ImportArchiveView, ImportDetail, ImportRowView } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, httpStatusOf, useTRPC } from "~/lib/trpc";
import { button, column, formatDay, formatTime, h1, lede as ledeClass, plural } from "~/lib/ui";
import { useShell } from "../../../_components/AppShell";

/* ───────────── wording ───────────── */

const fieldLabel: Record<string, string> = {
  movieTitle: "Title",
  auditorium: "Auditorium",
  startTime: "Start",
  endTime: "End",
  language: "Language",
  format: "Format",
  rating: "Rating",
  status: "Status",
};

function modelName(model: string | null) {
  if (!model) return "the agent";
  const id = (model.split(" via ")[0] ?? model).split("/").pop() ?? model;
  return id
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^Gpt/, "GPT")
    .replace(/(\d) (\d)/, "$1.$2");
}

function actionWord(row: ImportRowView) {
  if (row.outcome === "add") return "Add";
  if (row.outcome === "update") {
    if (row.matchMethod === "reactivated") return "Restore";
    if (row.matchMethod === "moved") return "Move";
    return "Update";
  }
  if (row.outcome === "unchanged") return "No change";
  if (row.outcome === "duplicate") return "Skip";
  return "Can't import";
}

const isTime = (f: string) => f === "startTime" || f === "endTime";

/** The change in plain words: "Auditorium 1 becomes Aud 1, moves from 10:30 AM to 10:45 AM". */
function describeDiffs(row: ImportRowView, tz?: string) {
  const t = (v: string) => (v ? formatTime(v, tz) : "?");
  const parts = row.diffs
    .filter((d) => d.field !== "status")
    .map((d) => {
      if (d.field === "auditorium") return `${d.oldValue} becomes ${d.newValue}`;
      if (d.field === "startTime") return `moves from ${t(d.oldValue)} to ${t(d.newValue)}`;
      if (d.field === "endTime") return `ends at ${t(d.newValue)} instead of ${t(d.oldValue)}`;
      if (d.field === "movieTitle") return `title becomes "${d.newValue}"`;
      return `${(fieldLabel[d.field] ?? d.field).toLowerCase()} ${d.oldValue} becomes ${d.newValue}`;
    });
  const text = parts.join(", ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** "Partner wrote X; keeping Y." warnings become a short note on the change line. */
function partnerTitle(row: ImportRowView) {
  const w = row.warnings.find((x) => x.column === "movie_title" && x.message.startsWith("Partner wrote"));
  const m = w?.message.match(/^Partner wrote "(.*)"; keeping/);
  return m?.[1] ?? null;
}

/* ───────────── page ───────────── */

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { theaters, notify } = useShell();
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
  return <Review detail={detail.data} timezone={tz} notify={notify} />;
}

type Item =
  { kind: "row"; key: string; row: ImportRowView } | { kind: "archive"; key: string; archive: ImportArchiveView };

function Review({
  detail,
  timezone,
  notify,
}: {
  detail: ImportDetail;
  timezone?: string;
  notify: (t: string, tone?: "ok" | "error") => void;
}) {
  const trpc = useTRPC();
  const { theaterId, setTheaterId } = useShell();
  // The bar's theater should be the one this import belongs to.
  useEffect(() => {
    if (theaterId !== detail.summary.theaterId) setTheaterId(detail.summary.theaterId);
  }, [theaterId, detail.summary.theaterId, setTheaterId]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { summary, rows, archives } = detail;
  const agent = summary.agent;
  const open = summary.status === "previewed";

  // Actionable items, in reading order: changes to existing showtimes, new ones, removals.
  const items = useMemo<Item[]>(() => {
    // Riskiest first: changes to existing showtimes, then removals, then new showtimes.
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
  const [focus, setFocus] = useState(0);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [showAllAdds, setShowAllAdds] = useState(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const approvedCount = items.filter((i) => accepted[i.key]).length;
  const approvedArchives = items.filter((i) => i.kind === "archive" && accepted[i.key]).length;
  const largeArchive = summary.activeBefore > 0 && approvedArchives > summary.activeBefore / 2;
  const nothingToDo = items.length === 0;

  const toggle = useCallback((key: string) => open && setAccepted((a) => ({ ...a, [key]: !a[key] })), [open]);

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
        notify("Import discarded. Nothing changed.");
        router.push("/");
      },
      onError: (e) => notify(errorMessage(e), "error"),
    }),
  );

  const apply = useCallback(() => {
    if (!open || commit.isPending || httpStatusOf(commit.error) === 409 || (largeArchive && !confirmLarge)) return;
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
  }, [open, commit, largeArchive, confirmLarge, summary.id, items, accepted]);

  // Keyboard review: j/k or arrows move, space toggles, e expands, enter applies.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") && !t.closest("[data-review-row]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        apply();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const move = (d: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(items.length - 1, focus + d));
        setFocus(next);
        rowRefs.current[next]?.focus();
      };
      if (e.key === "j" || e.key === "ArrowDown") move(1);
      else if (e.key === "k" || e.key === "ArrowUp") move(-1);
      else if (e.key === " " && t.closest("[data-review-row]")) {
        e.preventDefault();
        const it = items[focus];
        if (it) toggle(it.key);
      } else if (e.key === "e" && t.closest("[data-review-row]")) {
        const it = items[focus];
        if (it) setExpanded((x) => (x === it.key ? null : it.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, focus, toggle, apply]);

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
          {items.map((it, idx) => {
            const isAdd = it.kind === "row" && it.row.outcome === "add";
            if (isAdd && !showAllAdds && addIndex(items, idx) >= ADD_PREVIEW) {
              if (addIndex(items, idx) !== ADD_PREVIEW) return null;
              const rest = items.filter((x) => x.kind === "row" && x.row.outcome === "add").length - ADD_PREVIEW;
              const addKeys = items.filter((x) => x.kind === "row" && x.row.outcome === "add").map((x) => x.key);
              const allOn = addKeys.every((k) => accepted[k]);
              return (
                <div
                  key="more-adds"
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3.5 text-[13px]"
                >
                  <span className="text-ink-2">{plural(rest, "more new showtime")}</span>
                  <button type="button" className={button.link} onClick={() => setShowAllAdds(true)}>
                    Show all
                  </button>
                  {open && (
                    <button
                      type="button"
                      className={button.link}
                      onClick={() =>
                        setAccepted((a) => ({ ...a, ...Object.fromEntries(addKeys.map((k) => [k, !allOn])) }))
                      }
                    >
                      {allOn ? "Untick all new showtimes" : "Tick all new showtimes"}
                    </button>
                  )}
                </div>
              );
            }
            return (
              <ChangeRow
                key={it.key}
                item={it}
                index={idx}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                accepted={!!accepted[it.key]}
                open={open}
                expanded={expanded === it.key}
                onToggle={() => toggle(it.key)}
                onExpand={() => setExpanded((x) => (x === it.key ? null : it.key))}
                onFocus={() => setFocus(idx)}
                timezone={timezone}
                applied={applied}
              />
            );
          })}
        </div>
      )}

      {/* The rest, quietly: same list, dimmed, nothing to approve */}
      {(duplicates.length > 0 || unchanged.length > 0 || rejected.length > 0) && (
        <ul aria-label="Rows that need nothing" className={nothingToDo ? "mt-6 border-t border-line" : ""}>
          {duplicates.map((r) => (
            <QuietRow
              key={r.lineNumber}
              title={`Duplicate of line ${r.duplicateOf ?? "?"}${r.movieTitle ? `: ${r.movieTitle}` : ""}`}
              when={
                r.startTime
                  ? `${new Date(r.startTime).toLocaleDateString("en-US", { weekday: "short", timeZone: timezone })} ${formatTime(r.startTime, timezone)}`
                  : ""
              }
              text={`Skipped. ${r.explanation ?? "Same film and start time as an earlier row."}`}
            />
          ))}
          {unchanged.map((r) => (
            <QuietRow
              key={r.lineNumber}
              title={r.movieTitle ?? "Showtime"}
              when={
                r.startTime
                  ? `${new Date(r.startTime).toLocaleDateString("en-US", { weekday: "short", timeZone: timezone })} ${formatTime(r.startTime, timezone)}`
                  : ""
              }
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

/* ───────────── rows ───────────── */

const ADD_PREVIEW = 10;
/** Position of item idx among the add rows (adds are contiguous at the end). */
function addIndex(items: Item[], idx: number) {
  let n = 0;
  for (let i = 0; i < idx; i++) {
    const it = items[i]!;
    if (it.kind === "row" && it.row.outcome === "add") n++;
  }
  return n;
}

function ChangeRow({
  item,
  index,
  ref,
  accepted,
  open,
  expanded,
  onToggle,
  onExpand,
  onFocus,
  timezone,
  applied,
}: {
  item: Item;
  index: number;
  ref: (el: HTMLDivElement | null) => void;
  accepted: boolean;
  open: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onFocus: () => void;
  timezone?: string;
  applied: boolean;
}) {
  const isArchive = item.kind === "archive";
  const row = item.kind === "row" ? item.row : null;
  const archive = item.kind === "archive" ? item.archive : null;

  const action = isArchive ? "Archive" : actionWord(row!);
  const film = isArchive ? archive!.movieTitle : (row!.movieTitle ?? "Untitled");
  const reason = isArchive ? archive!.explanation : row!.explanation;
  const start = isArchive ? archive!.startTime : row!.startTime;
  const when = start
    ? `${new Date(start).toLocaleDateString("en-US", { weekday: "short", timeZone: timezone })} ${formatTime(start, timezone)}`
    : "";
  const change = (() => {
    if (isArchive) return reason ? `${archive!.auditorium}.` : `${archive!.auditorium}. Not in this drop.`;
    if (row!.outcome === "add")
      return `${row!.auditorium ?? ""}, until ${row!.endTime ? formatTime(row!.endTime, timezone) : "?"}.`;
    const diffs = describeDiffs(row!, timezone);
    const kept = partnerTitle(row!);
    const parts = [
      diffs ? `${diffs}.` : row!.matchMethod === "reactivated" ? "Archived, back in this drop." : "",
      kept ? "Title kept as yours." : "",
    ];
    return parts.filter(Boolean).join(" ");
  })();

  const confidence = row?.confidence ?? null;
  const low = confidence !== null && confidence < 0.75;
  const id = `change-${index}`;

  return (
    <div
      role="listitem"
      className={`border-b border-line transition-colors duration-150 ${expanded ? "bg-[#fbfbfb]" : ""}`}
    >
      <div
        ref={ref}
        data-review-row
        tabIndex={0}
        onFocus={onFocus}
        className="group flex cursor-default gap-3.5 rounded-md py-3.5 outline-offset-[-2px] focus-visible:outline-2"
      >
        <div className="pt-0.5">
          <input
            id={id}
            type="checkbox"
            tabIndex={-1}
            checked={accepted}
            disabled={!open}
            onChange={onToggle}
            aria-label={`${accepted ? "Approved" : "Not approved"}: ${action} ${film}`}
            className="size-4 cursor-pointer rounded disabled:cursor-default"
          />
        </div>
        <div className={`min-w-0 flex-1 transition-opacity duration-150 ${accepted ? "" : "opacity-55"}`}>
          <div className="flex items-baseline gap-3">
            <label
              htmlFor={id}
              className={`min-w-0 flex-1 cursor-pointer ${applied && !accepted ? "line-through decoration-ink-3" : ""}`}
            >
              <span className={`font-semibold ${isArchive ? "text-remove" : ""}`}>{action}</span>{" "}
              <span className="font-semibold">{film}</span>
              <span className="tnum ml-2 text-[13px] text-ink-2">{when}</span>
            </label>
            {confidence !== null && (
              <span
                className={`tnum shrink-0 text-[13px] ${low ? "font-medium text-risk" : "text-ink-3"}`}
                title="Agent confidence"
              >
                {low && "Check  "}
                {Math.round(confidence * 100)}%
              </span>
            )}
            <button
              type="button"
              tabIndex={-1}
              onClick={onExpand}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide details" : "Show details"}
              className="-mr-1.5 shrink-0 self-center rounded p-0.5 text-ink-3 transition-colors hover:bg-wash hover:text-ink"
            >
              <ChevronDown
                aria-hidden
                className={`size-3.5 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          <p className={`mt-0.5 text-[13px] leading-relaxed text-pretty text-ink-2 ${expanded ? "" : "line-clamp-2"}`}>
            {change} {reason}
            {row?.aiOverrodeRules && " Found by the agent."}
          </p>
          {expanded && <Details item={item} timezone={timezone} />}
        </div>
      </div>
    </div>
  );
}

function Details({ item, timezone }: { item: Item; timezone?: string }) {
  if (item.kind === "archive") {
    const a = item.archive;
    return (
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-ink-2">Showtime</dt>
        <dd>
          {a.movieTitle}, {a.auditorium}
        </dd>
        <dt className="text-ink-2">Runs</dt>
        <dd className="tnum">
          {formatDay(a.startTime, timezone)}, {formatTime(a.startTime, timezone)} to {formatTime(a.endTime, timezone)}
        </dd>
        <dt className="text-ink-2">Decided by</dt>
        <dd>
          {a.decisionSource === "ai" ? "The agent explained it; " : ""}the rule is that showtimes missing from a new
          drop are archived. Untick to keep it.
        </dd>
      </dl>
    );
  }
  const r = item.row;
  // Postgres stores the row as jsonb (keys reordered), so put the usual columns back in file order.
  const ORDER = ["theater_name", "movie_title", "auditorium", "start_time", "end_time", "language", "format", "rating", "last_updated"];
  const rank = (k: string) => {
    const i = ORDER.indexOf(k.toLowerCase());
    return i === -1 ? ORDER.length : i;
  };
  const rawLine = Object.entries(r.raw)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([k, v]) => `${k}: ${v.trim() === "" ? "(blank)" : v}`)
    .join("\n");
  return (
    <div className="mt-3 space-y-3 text-[13px]">
      {r.diffs.length > 0 && (
        <table className="w-full max-w-md text-left">
          <thead className="text-[12px] text-ink-2">
            <tr>
              <th className="pb-1 font-normal">Field</th>
              <th className="pb-1 font-normal">Now</th>
              <th className="pb-1 font-normal">In this drop</th>
            </tr>
          </thead>
          <tbody>
            {r.diffs.map((d) => {
              const show = (v: string) =>
                isTime(d.field) && v ? `${formatDay(v, timezone)}, ${formatTime(v, timezone)}` : v;
              return (
                <tr key={d.field} className="border-t border-line">
                  <td className="py-1 pr-3 text-ink-2">{fieldLabel[d.field] ?? d.field}</td>
                  <td className="py-1 pr-3 text-ink-2 line-through decoration-ink-3">{show(d.oldValue)}</td>
                  <td className="py-1">{show(d.newValue)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {r.warnings.length > 0 && (
        <ul className="space-y-0.5 text-ink-2">
          {r.warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-[12px] text-ink-2">Line {r.lineNumber} as sent</p>
        <pre className="mt-1 overflow-x-auto rounded-md bg-wash px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">
          {rawLine}
        </pre>
      </div>
      <p className="text-ink-2">
        {r.decisionSource === "ai"
          ? r.aiOverrodeRules
            ? "Decided by the agent. The matching rules alone would have handled this row differently; the match was checked against the stored schedule before it was shown."
            : "Decided by the agent and checked against the stored schedule."
          : "Decided by the matching rules."}
      </p>
    </div>
  );
}

function QuietRow({ title, when, text, tone }: { title: string; when: string; text: string; tone?: "error" }) {
  return (
    <li className="flex gap-3.5 border-b border-line py-3.5 text-[13px]">
      <input type="checkbox" disabled aria-hidden tabIndex={-1} className="mt-0.5 size-4 rounded opacity-30" />
      <div className="min-w-0 flex-1">
        <p className="text-ink-3">
          <span className={`font-semibold ${tone === "error" ? "text-remove" : ""}`}>{title}</span>
          {when && <span className="tnum ml-2">{when}</span>}
        </p>
        <p className="mt-0.5 text-pretty text-ink-3">{text}</p>
      </div>
    </li>
  );
}
