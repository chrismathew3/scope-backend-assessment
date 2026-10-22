"use client";

import {
  ADMIN_ONLY_SORTS,
  MOVIE_STATUSES,
  type MovieStatus,
  SHOWTIME_STATUSES,
  type ShowtimeRow,
  type ShowtimeSort,
  type ShowtimeStatus,
} from "@scope/shared";
import { formatDateTime, smallSelectClass } from "~/lib/ui";

interface Props {
  rows: ShowtimeRow[];
  timezones: Record<string, string>;
  showTheaterColumn: boolean;
  /** Show movie status / status / last updated columns (caller is admin somewhere in scope). */
  showInternalColumns: boolean;
  /** Admin-only sorts are allowed only when the caller is admin of every theater in scope. */
  allowAdminSorts: boolean;
  sort: ShowtimeSort;
  order: "asc" | "desc";
  onSort: (sort: ShowtimeSort) => void;
  onUpdate: (
    row: Extract<ShowtimeRow, { access: "admin" }>,
    patch: { movieStatus?: MovieStatus; status?: ShowtimeStatus },
  ) => void;
  pendingId: string | null;
  isLoading: boolean;
}

const statusBadge: Record<ShowtimeStatus, string> = {
  active: "bg-green-900 text-green-300",
  inactive: "bg-amber-900 text-amber-300",
  archived: "bg-gray-700 text-gray-400",
};

export function ShowtimesTable({
  rows,
  timezones,
  showTheaterColumn,
  showInternalColumns,
  allowAdminSorts,
  sort,
  order,
  onSort,
  onUpdate,
  pendingId,
  isLoading,
}: Props) {
  const Th = ({ field, children }: { field?: ShowtimeSort; children: React.ReactNode }) => {
    const sortable = field && (allowAdminSorts || !ADMIN_ONLY_SORTS.includes(field));
    if (!sortable) return <th className="px-4 py-3 whitespace-nowrap">{children}</th>;
    const active = sort === field;
    return (
      <th
        className="px-4 py-3 whitespace-nowrap"
        aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => onSort(field)}
          className="inline-flex items-center gap-1 uppercase hover:text-white"
        >
          {children}
          <span className={active ? "text-white" : "text-gray-600"}>
            {active ? (order === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  const columnCount = 7 + (showTheaterColumn ? 1 : 0) + (showInternalColumns ? 3 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-800 text-xs text-gray-400 uppercase">
          <tr>
            {showTheaterColumn && <Th field="theaterName">Theater</Th>}
            <Th field="movieTitle">Movie title</Th>
            {showInternalColumns && <Th field="movieStatus">Movie status</Th>}
            <Th>Auditorium</Th>
            <Th field="startTime">Start</Th>
            <Th field="endTime">End</Th>
            <Th>Language</Th>
            <Th>Format</Th>
            <Th>Rating</Th>
            {showInternalColumns && <Th>Status</Th>}
            {showInternalColumns && <Th field="lastUpdated">Last updated</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-10 text-center text-gray-400">
                {isLoading ? "Loading…" : "No showtimes match these filters"}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const tz = timezones[row.theaterId];
              const admin = row.access === "admin" ? row : null;
              const busy = pendingId === row.id;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-gray-800 hover:bg-gray-800/60 ${admin?.status === "archived" ? "opacity-50" : ""}`}
                >
                  {showTheaterColumn && <td className="px-4 py-3 text-gray-300">{row.theaterName}</td>}
                  <td className="px-4 py-3 font-medium text-white">{row.movieTitle}</td>
                  {showInternalColumns && (
                    <td className="px-4 py-3">
                      {admin ? (
                        <select
                          aria-label={`Movie status for ${row.movieTitle}`}
                          value={admin.movieStatus}
                          disabled={busy}
                          onChange={(e) => onUpdate(admin, { movieStatus: e.target.value as MovieStatus })}
                          className={smallSelectClass}
                        >
                          {MOVIE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-300">{row.auditorium}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-300">{formatDateTime(row.startTime, tz)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-300">{formatDateTime(row.endTime, tz)}</td>
                  <td className="px-4 py-3 text-gray-300">{row.language}</td>
                  <td className="px-4 py-3 text-gray-300">{row.format}</td>
                  <td className="px-4 py-3 text-gray-300">{row.rating}</td>
                  {showInternalColumns && (
                    <td className="px-4 py-3">
                      {admin ? (
                        <select
                          aria-label={`Status for ${row.movieTitle}`}
                          value={admin.status}
                          disabled={busy}
                          onChange={(e) => onUpdate(admin, { status: e.target.value as ShowtimeStatus })}
                          className={`${smallSelectClass} ${statusBadge[admin.status]}`}
                        >
                          {SHOWTIME_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  )}
                  {showInternalColumns && (
                    <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                      {admin ? formatDateTime(admin.lastUpdated) : "—"}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
