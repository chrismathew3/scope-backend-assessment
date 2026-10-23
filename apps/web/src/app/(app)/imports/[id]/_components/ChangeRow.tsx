import { ChevronDown } from "lucide-react";
import { formatDay, formatTime, formatWeekdayTime } from "~/lib/ui";
import { actionWord, describeDiffs, fieldLabel, isTime, type Item } from "./wording";

export function ChangeRow({
  item,
  ref,
  accepted,
  open,
  expanded,
  onToggle,
  onExpand,
  timezone,
  applied,
}: {
  item: Item;
  ref: (el: HTMLDivElement | null) => void;
  accepted: boolean;
  open: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
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
  const when = start ? formatWeekdayTime(start, timezone) : "";
  const change = (() => {
    if (isArchive) return reason ? `${archive!.auditorium}.` : `${archive!.auditorium}. Not in this drop.`;
    if (row!.outcome === "add")
      return `${row!.auditorium ?? ""}, until ${row!.endTime ? formatTime(row!.endTime, timezone) : "?"}.`;
    const diffs = describeDiffs(row!, timezone);
    const kept = row!.partnerTitle;
    const parts = [
      diffs ? `${diffs}.` : row!.matchMethod === "reactivated" ? "Archived, back in this drop." : "",
      kept ? `The drop wrote "${kept}"; your title is kept. Untick if it's a different film.` : "",
    ];
    return parts.filter(Boolean).join(" ");
  })();

  const confidence = row?.confidence ?? null;
  const low = confidence !== null && confidence < 0.75;
  const id = `change-${item.key}`;

  return (
    <div
      role="listitem"
      className={`border-b border-line [overflow-wrap:anywhere] transition-colors duration-150 ${expanded ? "bg-wash-soft" : ""}`}
    >
      <div
        ref={ref}
        data-review-row
        tabIndex={0}
        role="group"
        aria-label={`${action} ${film}${when ? `, ${when}` : ""}`}
        className="group flex cursor-default gap-3.5 rounded-md py-3.5 outline-offset-[-2px] focus-visible:outline-2"
      >
        <div className="pt-0.5">
          <input
            id={id}
            type="checkbox"
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
          {a.decisionSource === "ai" ? "The agent explained it. " : ""}The rule is that showtimes missing from a new
          drop are archived. Untick to keep it.
        </dd>
      </dl>
    );
  }
  const r = item.row;
  // Postgres stores the row as jsonb (keys reordered), so put the usual columns back in file order.
  const ORDER = [
    "theater_name",
    "movie_title",
    "auditorium",
    "start_time",
    "end_time",
    "language",
    "format",
    "rating",
    "last_updated",
  ];
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
