"use client";

import { useState } from "react";
import { useDebounce } from "~/lib/hooks/useDebounce";

type Showtime = {
  id: string;
  theaterName: string;
  movieTitle: string;
  auditorium: string;
  startTime: Date;
  endTime: Date;
  language: string;
  format: string;
  rating: string;
  lastUpdated: Date;
  status: string;
};

type SortField = "movieTitle" | "startTime" | "endTime" | "lastUpdated";
type SortOrder = "asc" | "desc";

interface ShowtimesTableProps {
  showtimes: Showtime[];
}

export function ShowtimesTable({ showtimes }: ShowtimesTableProps) {
  const [sortField, setSortField] = useState<SortField>("startTime");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Debounce the search query with 300ms delay
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

  const sortedShowtimes = [...filteredShowtimes].sort((a, b) => {
    let aVal: string | Date = a[sortField];
    let bVal: string | Date = b[sortField];

    if (aVal instanceof Date && bVal instanceof Date) {
      return sortOrder === "asc"
        ? aVal.getTime() - bVal.getTime()
        : bVal.getTime() - aVal.getTime();
    }

    aVal = String(aVal);
    bVal = String(bVal);

    if (sortOrder === "asc") {
      return aVal.localeCompare(bVal);
    } else {
      return bVal.localeCompare(aVal);
    }
  });

  const formatDateTime = (date: Date) => {
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
              <th
                className="cursor-pointer px-4 py-3 hover:bg-gray-700"
                onClick={() => handleSort("movieTitle")}
              >
                Movie Title <SortIcon field="movieTitle" />
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
            </tr>
          </thead>
          <tbody>
            {sortedShowtimes.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
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
                  <td className="px-4 py-3 font-medium text-white">
                    {showtime.movieTitle}
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
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        showtime.status === "active"
                          ? "bg-green-900 text-green-300"
                          : "bg-gray-700 text-gray-400"
                      }`}
                    >
                      {showtime.status}
                    </span>
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

