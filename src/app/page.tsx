"use client";

import { useEffect, useMemo, useState } from "react";
import { assessmentData } from "~/data/assessment-data";
import { useMockSession } from "~/lib/mock-session";
import type { MovieStatus, PreviewChanges, Showtime, Theater } from "~/types/assessment";
import { FileUpload } from "./_components/FileUpload";
import { FilterBar } from "./_components/FilterBar";
import { PreviewModal } from "./_components/PreviewModal";
import { ShowtimesTable } from "./_components/ShowtimesTable";

const emptyPreview: PreviewChanges = {
  adds: [],
  updates: [],
  archives: [],
};

const uniqueSorted = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort();

export default function Home() {
  const { user, userId, setUserId, signOut } = useMockSession();
  const [showtimes, setShowtimes] = useState<Showtime[]>(assessmentData.showtimes);
  const [selectedTheaterId, setSelectedTheaterId] = useState<string>("all");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewChanges>(emptyPreview);

  const [filters, setFilters] = useState({
    status: "all" as "active" | "inactive" | "archived" | "all",
    format: "",
    language: "",
    rating: "",
    auditorium: "",
    movieStatus: "",
    startDate: "",
    endDate: "",
  });

  const isAdmin = user?.role === "admin";

  const theatersById = useMemo(() => {
    return assessmentData.theaters.reduce(
      (acc, theater) => {
        acc[theater.id] = theater;
        return acc;
      },
      {} as Record<string, Theater>,
    );
  }, []);

  const accessibleTheaters = useMemo(() => {
    if (!user) return [];
    return assessmentData.theaters.filter((theater) =>
      user.theaterIds.includes(theater.id),
    );
  }, [user]);

  const accessibleTheaterIds = useMemo(
    () => new Set(accessibleTheaters.map((theater) => theater.id)),
    [accessibleTheaters],
  );

  useEffect(() => {
    if (!user) return;
    if (
      selectedTheaterId !== "all" &&
      !user.theaterIds.includes(selectedTheaterId)
    ) {
      setSelectedTheaterId("all");
    }
  }, [selectedTheaterId, user]);

  const showtimesForUser = useMemo(() => {
    if (!user) return [];
    return showtimes.filter((showtime) =>
      accessibleTheaterIds.has(showtime.theaterId),
    );
  }, [accessibleTheaterIds, showtimes, user]);

  const scopedShowtimes = useMemo(() => {
    if (selectedTheaterId === "all") return showtimesForUser;
    return showtimesForUser.filter(
      (showtime) => showtime.theaterId === selectedTheaterId,
    );
  }, [selectedTheaterId, showtimesForUser]);

  const filteredShowtimes = useMemo(() => {
    let result = scopedShowtimes;

    if (filters.status !== "all") {
      result = result.filter((showtime) => showtime.status === filters.status);
    }
    if (filters.format) {
      result = result.filter((showtime) => showtime.format === filters.format);
    }
    if (filters.language) {
      result = result.filter(
        (showtime) => showtime.language === filters.language,
      );
    }
    if (filters.rating) {
      result = result.filter((showtime) => showtime.rating === filters.rating);
    }
    if (filters.auditorium) {
      result = result.filter(
        (showtime) => showtime.auditorium === filters.auditorium,
      );
    }
    if (filters.movieStatus) {
      result = result.filter(
        (showtime) => showtime.movieStatus === filters.movieStatus,
      );
    }
    if (filters.startDate || filters.endDate) {
      const startDate = filters.startDate
        ? new Date(filters.startDate)
        : null;
      const endDate = filters.endDate ? new Date(filters.endDate) : null;
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
      }

      result = result.filter((showtime) => {
        const showtimeDate = new Date(showtime.startTime);
        if (startDate && showtimeDate < startDate) return false;
        if (endDate && showtimeDate > endDate) return false;
        return true;
      });
    }

    return result;
  }, [filters, scopedShowtimes]);

  const filterOptions = useMemo(() => {
    return {
      formats: uniqueSorted(scopedShowtimes.map((st) => st.format)),
      languages: uniqueSorted(scopedShowtimes.map((st) => st.language)),
      ratings: uniqueSorted(scopedShowtimes.map((st) => st.rating)),
      auditoriums: uniqueSorted(scopedShowtimes.map((st) => st.auditorium)),
      movieStatuses: uniqueSorted(scopedShowtimes.map((st) => st.movieStatus)),
    };
  }, [scopedShowtimes]);

  const previewForTheater = useMemo(() => {
    if (selectedTheaterId === "all") return emptyPreview;
    return (
      assessmentData.previewChangesByTheater[selectedTheaterId] ?? emptyPreview
    );
  }, [selectedTheaterId]);

  const handleFileSelect = (_content: string) => {
    setPreviewData(previewForTheater);
    setIsPreviewOpen(true);
  };

  const handleConfirmChanges = () => {
    setIsPreviewOpen(false);
  };

  const handleClearSchedule = () => {
    if (selectedTheaterId === "all") {
      alert("Select a single theater before clearing the schedule.");
      return;
    }
    if (
      confirm(
        "Are you sure you want to archive all showtimes for this theater?",
      )
    ) {
      setShowtimes((current) =>
        current.map((showtime) =>
          showtime.theaterId === selectedTheaterId
            ? { ...showtime, status: "archived" }
            : showtime,
        ),
      );
    }
  };

  const handleMovieStatusChange = (showtimeId: string, status: MovieStatus) => {
    setShowtimes((current) =>
      current.map((showtime) =>
        showtime.id === showtimeId
          ? { ...showtime, movieStatus: status }
          : showtime,
      ),
    );
  };

  const activeCount = filteredShowtimes.filter(
    (showtime) => showtime.status === "active",
  ).length;

  const statusOptions = ["active", "inactive", "archived"] as const;

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#1a0b2e] to-[#0f0720]">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="mb-2 text-4xl font-bold text-white">
              Theater Showtimes Manager
            </h1>
            <p className="text-gray-400">
              Upload partner CSV files to manage showtimes
            </p>
          </div>

          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-4">
            <p className="text-xs uppercase text-gray-500">Session</p>
            <div className="mt-2 flex flex-col gap-3">
              <select
                value={userId ?? ""}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="" disabled>
                  Select a user
                </option>
                {assessmentData.users.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.role})
                  </option>
                ))}
              </select>
              {user ? (
                <div className="text-sm text-gray-400">
                  <div className="flex items-center justify-between">
                    <span>{user.email}</span>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        isAdmin
                          ? "bg-purple-900 text-purple-200"
                          : "bg-gray-700 text-gray-200"
                      }`}
                    >
                      {user.role}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Theaters: {user.theaterIds.length || 0}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  No user selected.
                </div>
              )}
              <button
                onClick={signOut}
                className="rounded-lg border border-gray-600 px-3 py-2 text-xs font-semibold text-gray-300 transition hover:bg-gray-800"
              >
                Clear selection
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase text-gray-400">
              Theater Scope
            </label>
            <select
              value={selectedTheaterId}
              onChange={(e) => setSelectedTheaterId(e.target.value)}
              disabled={!accessibleTheaters.length}
              className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            >
              <option value="all">All accessible theaters</option>
              {accessibleTheaters.map((theater) => (
                <option key={theater.id} value={theater.id}>
                  {theater.name}
                </option>
              ))}
            </select>
          </div>

          <FileUpload
            onFileSelect={handleFileSelect}
            disabled={
              !isAdmin ||
              selectedTheaterId === "all" ||
              accessibleTheaters.length === 0
            }
          />

          <button
            onClick={handleClearSchedule}
            disabled={
              !isAdmin ||
              selectedTheaterId === "all" ||
              accessibleTheaters.length === 0
            }
            className="rounded-lg border border-red-600 px-6 py-3 font-semibold text-red-400 transition hover:bg-red-950 disabled:opacity-50"
          >
            Clear Schedule
          </button>

          <div className="ml-auto text-sm text-gray-400">
            {filteredShowtimes.length > 0 && (
              <>
                {activeCount} active showtimes
                {selectedTheaterId === "all" ? " across theaters" : ""}
              </>
            )}
          </div>
        </div>

        {!isAdmin && (
          <div className="mb-6 rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-400">
            You are in read-only mode. Admin users can upload CSVs and update
            movie status.
          </div>
        )}

        {accessibleTheaters.length === 0 ? (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-8 text-center text-gray-400">
            This user does not belong to any theaters yet.
          </div>
        ) : (
          <>
            <FilterBar
              status={filters.status}
              format={filters.format}
              language={filters.language}
              rating={filters.rating}
              auditorium={filters.auditorium}
              movieStatus={filters.movieStatus}
              startDate={filters.startDate}
              endDate={filters.endDate}
              onFilterChange={setFilters}
              availableFormats={filterOptions.formats}
              availableLanguages={filterOptions.languages}
              availableRatings={filterOptions.ratings}
              availableAuditoriums={filterOptions.auditoriums}
              availableMovieStatuses={filterOptions.movieStatuses}
            />

            <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
              <ShowtimesTable
                showtimes={filteredShowtimes}
                theatersById={theatersById}
                showTheaterColumn={selectedTheaterId === "all"}
                isAdmin={!!isAdmin}
                movieStatusOptions={assessmentData.movieStatusOptions}
                statusOptions={statusOptions}
                onMovieStatusChange={
                  isAdmin ? handleMovieStatusChange : undefined
                }
                onStatusChange={
                  isAdmin
                    ? (showtimeId, status) => {
                        setShowtimes((current) =>
                          current.map((showtime) =>
                            showtime.id === showtimeId
                              ? { ...showtime, status }
                              : showtime,
                          ),
                        );
                      }
                    : undefined
                }
              />
            </div>
          </>
        )}

        <PreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          onConfirm={handleConfirmChanges}
          changes={previewData}
          isApplying={false}
        />
      </div>
    </main>
  );
}
