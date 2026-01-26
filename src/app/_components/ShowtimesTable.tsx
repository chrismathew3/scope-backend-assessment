"use client";

import { useState } from "react";
import { useDebounce } from "~/lib/hooks/useDebounce";
import type { MovieStatus, Showtime, ShowtimeStatus, Theater } from "~/types/assessment";

type SortField =
  | "movieTitle"
  | "startTime"
  | "endTime"
  | "lastUpdated"
  | "theaterName"
  | "movieStatus";
type SortOrder = "asc" | "desc";

interface ShowtimesTableProps {
  showtimes: Showtime[];
  theatersById: Record<string, Theater>;
  showTheaterColumn: boolean;
  isAdmin: boolean;
  movieStatusOptions: MovieStatus[];
  statusOptions: readonly ShowtimeStatus[];
  onMovieStatusChange?: (showtimeId: string, status: MovieStatus) => void;
  onStatusChange?: (showtimeId: string, status: ShowtimeStatus) => void;
}

export function ShowtimesTable({
  showtimes,
  theatersById,
  showTheaterColumn,
  isAdmin,
  movieStatusOptions,
  statusOptions,
  onMovieStatusChange,
  onStatusChange,
}: ShowtimesTableProps) {
  const [sortField, setSortField] = useState<SortField>("startTime");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [searchQuery, setSearchQuery] = useState("");

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const filteredShowtimes = showtimes.filter((st) =>
    st.movieTitle.toLowerCase().includes(debouncedSearchQuery.toLowerCase()),
  );

  const getSortValue = (showtime: Showtime) => {
    switch (sortField) {
      case "theaterName":
        return theatersById[showtime.theaterId]?.name ?? "";
      case "movieStatus":
        return showtime.movieStatus;
      case "movieTitle":
        return showtime.movieTitle;
      case "startTime":
        return new Date(showtime.startTime).getTime();
      case "endTime":
        return new Date(showtime.endTime).getTime();
      case "lastUpdated":
        return new Date(showtime.lastUpdated).getTime();
      default:
        return "";
    }
  };

  const sortedShowtimes = [...filteredShowtimes].sort((a, b) => {
    const aVal = getSortValue(a);
    const bVal = getSortValue(b);

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    }

    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortOrder === "asc"
      ? aStr.localeCompare(bStr)
      : bStr.localeCompare(aStr);
  });

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="ml-1 text-gray-500">↕</span>;
    return <span className="ml-1">{sortOrder === "asc" ? "↑" : "↓"}</span>;
  };

  const columnCount = 10 + (showTheaterColumn ? 1 : 0);

  return (
    <div className="w-full">
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by movie title..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800 text-xs uppercase text-gray-400">
            <tr>
              {showTheaterColumn && (
                <th
                  className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                  onClick={() => handleSort("theaterName")}
                >
                  Theater <SortIcon field="theaterName" />
                </th>
              )}
              <th
                className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                onClick={() => handleSort("movieTitle")}
              >
                Movie Title <SortIcon field="movieTitle" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                onClick={() => handleSort("movieStatus")}
              >
                Movie Status <SortIcon field="movieStatus" />
              </th>
              <th className="px-4 py-3">Auditorium</th>
              <th
                className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                onClick={() => handleSort("startTime")}
              >
                Start Time <SortIcon field="startTime" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                onClick={() => handleSort("endTime")}
              >
                End Time <SortIcon field="endTime" />
              </th>
              <th className="px-4 py-3">Language</th>
              <th className="px-4 py-3">Format</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Status</th>
              <th
                className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                onClick={() => handleSort("lastUpdated")}
              >
                Last Updated <SortIcon field="lastUpdated" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedShowtimes.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  No showtimes found
                </td>
              </tr>
            ) : (
              sortedShowtimes.map((showtime) => (
                <tr
                  key={showtime.id}
                  className={`border-b border-gray-700 hover:bg-gray-800 ${
                    showtime.status === "archived" ? "opacity-50" : ""
                  }`}
                >
                  {showTheaterColumn && (
                    <td className="px-4 py-3 text-gray-300">
                      {theatersById[showtime.theaterId]?.name ?? "Unknown"}
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium text-white">
                    {showtime.movieTitle}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {isAdmin ? (
                      <select
                        value={showtime.movieStatus}
                        onChange={(e) =>
                          onMovieStatusChange?.(
                            showtime.id,
                            e.target.value as MovieStatus,
                          )
                        }
                        className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        {movieStatusOptions.map((statusOption) => (
                          <option key={statusOption} value={statusOption}>
                            {statusOption}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-gray-700 px-2 py-1 text-xs text-gray-200">
                        {showtime.movieStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {showtime.auditorium}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatDateTime(showtime.startTime)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatDateTime(showtime.endTime)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {showtime.language}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {showtime.format}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {showtime.rating}
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <select
                        value={showtime.status}
                        onChange={(e) =>
                          onStatusChange?.(
                            showtime.id,
                            e.target.value as ShowtimeStatus,
                          )
                        }
                        className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        {statusOptions.map((statusOption) => (
                          <option key={statusOption} value={statusOption}>
                            {statusOption}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          showtime.status === "active"
                            ? "bg-green-900 text-green-300"
                            : showtime.status === "inactive"
                              ? "bg-amber-900 text-amber-300"
                              : "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {showtime.status}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {formatDateTime(showtime.lastUpdated)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
