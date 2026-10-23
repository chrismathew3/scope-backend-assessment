import type { ImportArchiveView, ImportRowView } from "@scope/shared";
import { formatTime } from "~/lib/ui";

/** One proposed change in the review list: a CSV row or a showtime missing from the drop. */
export type Item =
  { kind: "row"; key: string; row: ImportRowView } | { kind: "archive"; key: string; archive: ImportArchiveView };

export const fieldLabel: Record<string, string> = {
  movieTitle: "Title",
  auditorium: "Auditorium",
  startTime: "Start",
  endTime: "End",
  language: "Language",
  format: "Format",
  rating: "Rating",
  status: "Status",
};

export const isTime = (f: string) => f === "startTime" || f === "endTime";

export function modelName(model: string | null) {
  if (!model) return "the agent";
  const id = (model.split(" via ")[0] ?? model).split("/").pop() ?? model;
  return id
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^Gpt/, "GPT")
    .replace(/(\d) (\d)/, "$1.$2");
}

export function actionWord(row: ImportRowView) {
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

/** The change in plain words: "Auditorium 1 becomes Aud 1, moves from 10:30 AM to 10:45 AM". */
export function describeDiffs(row: ImportRowView, tz?: string) {
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
