"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { ShowtimesTable } from "./_components/ShowtimesTable";
import { PreviewModal } from "./_components/PreviewModal";
import { FileUpload } from "./_components/FileUpload";
import { FilterBar } from "./_components/FilterBar";
import type { PreviewChanges } from "~/server/api/routers/showtime";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [csvContent, setCsvContent] = useState<string>("");
  const [previewData, setPreviewData] = useState<PreviewChanges>({
    adds: [],
    updates: [],
    archives: [],
  });

  // Filter state
  const [filters, setFilters] = useState({
    status: "all" as "active" | "archived" | "all",
    format: "",
    language: "",
    rating: "",
    auditorium: "",
    startDate: "",
    endDate: "",
  });

  const utils = api.useUtils();

  // Fetch filter options
  const { data: filterOptions } = api.showtime.getFilterOptions.useQuery();

  // Fetch all showtimes with filters
  const { data: showtimes, isLoading } = api.showtime.getAll.useQuery({
    status: filters.status,
    sortBy: "startTime",
    sortOrder: "asc",
    format: filters.format,
    language: filters.language,
    rating: filters.rating,
    auditorium: filters.auditorium,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  // Preview changes mutation
  const previewMutation = api.showtime.previewChanges.useMutation({
    onSuccess: (data) => {
      setPreviewData(data);
      setIsPreviewOpen(true);
    },
    onError: (error) => {
      alert(`Error previewing changes: ${error.message}`);
    },
  });

  // Apply changes mutation
  const applyMutation = api.showtime.applyChanges.useMutation({
    onSuccess: async () => {
      setIsPreviewOpen(false);
      setCsvContent("");
      await utils.showtime.getAll.invalidate();
    },
    onError: (error) => {
      alert(`Error applying changes: ${error.message}`);
    },
  });

  // Clear schedule mutation
  const clearMutation = api.showtime.clearSchedule.useMutation({
    onSuccess: async () => {
      await utils.showtime.getAll.invalidate();
    },
    onError: (error) => {
      alert(`Error clearing schedule: ${error.message}`);
    },
  });

  const handleFileSelect = (content: string) => {
    setCsvContent(content);
    previewMutation.mutate({ csvContent: content });
  };

  const handleConfirmChanges = () => {
    if (csvContent) {
      applyMutation.mutate({ csvContent });
    }
  };

  const handleClearSchedule = () => {
    if (
      confirm(
        "Are you sure you want to archive all active showtimes? This action cannot be undone.",
      )
    ) {
      clearMutation.mutate();
    }
  };

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Show loading state while checking authentication
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#1a0b2e] to-[#0f0720]">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated
  if (!session) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#1a0b2e] to-[#0f0720]">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-4xl font-bold text-white">
              Theater Showtimes Manager
            </h1>
            <p className="text-gray-400">
              Upload partner CSV files to manage showtimes
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-gray-400">Signed in as</p>
              <p className="font-medium text-white">{session.user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-800"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <FileUpload
            onFileSelect={handleFileSelect}
            disabled={previewMutation.isPending}
          />

          <button
            onClick={handleClearSchedule}
            disabled={clearMutation.isPending || !showtimes?.length}
            className="rounded-lg border border-red-600 px-6 py-3 font-semibold text-red-400 transition hover:bg-red-950 disabled:opacity-50"
          >
            {clearMutation.isPending ? "Clearing..." : "Clear Schedule"}
          </button>

          <div className="ml-auto text-sm text-gray-400">
            {showtimes && (
              <>
                {showtimes.filter((st: { status: string }) => st.status === "active").length} active
                showtimes
              </>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        {filterOptions && (
          <FilterBar
            status={filters.status}
            format={filters.format}
            language={filters.language}
            rating={filters.rating}
            auditorium={filters.auditorium}
            startDate={filters.startDate}
            endDate={filters.endDate}
            onFilterChange={setFilters}
            availableFormats={filterOptions.formats}
            availableLanguages={filterOptions.languages}
            availableRatings={filterOptions.ratings}
            availableAuditoriums={filterOptions.auditoriums}
          />
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-8 text-center text-gray-400">
            Loading showtimes...
          </div>
        )}

        {/* Showtimes Table */}
        {!isLoading && showtimes && (
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
            <ShowtimesTable showtimes={showtimes} />
          </div>
        )}

        {/* Preview Modal */}
        <PreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          onConfirm={handleConfirmChanges}
          changes={previewData}
          isApplying={applyMutation.isPending}
        />
      </div>
    </main>
  );
}
