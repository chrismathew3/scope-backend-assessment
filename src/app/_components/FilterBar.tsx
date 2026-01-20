"use client";

interface FilterBarProps {
  status: "active" | "archived" | "all";
  format: string;
  language: string;
  rating: string;
  auditorium: string;
  startDate: string;
  endDate: string;
  onFilterChange: (filters: {
    status: "active" | "archived" | "all";
    format: string;
    language: string;
    rating: string;
    auditorium: string;
    startDate: string;
    endDate: string;
  }) => void;
  availableFormats: string[];
  availableLanguages: string[];
  availableRatings: string[];
  availableAuditoriums: string[];
}

export function FilterBar({
  status,
  format,
  language,
  rating,
  auditorium,
  startDate,
  endDate,
  onFilterChange,
  availableFormats,
  availableLanguages,
  availableRatings,
  availableAuditoriums,
}: FilterBarProps) {
  const handleChange = (field: string, value: string) => {
    onFilterChange({
      status,
      format,
      language,
      rating,
      auditorium,
      startDate,
      endDate,
      [field]: value,
    });
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase text-gray-400">
        Filters
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Status Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Status</label>
          <select
            value={status}
            onChange={(e) =>
              handleChange("status", e.target.value as "active" | "archived" | "all")
            }
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Format Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Format</label>
          <select
            value={format}
            onChange={(e) => handleChange("format", e.target.value)}
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Formats</option>
            {availableFormats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {/* Language Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Language</label>
          <select
            value={language}
            onChange={(e) => handleChange("language", e.target.value)}
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Languages</option>
            {availableLanguages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* Rating Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Rating</label>
          <select
            value={rating}
            onChange={(e) => handleChange("rating", e.target.value)}
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Ratings</option>
            {availableRatings.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Auditorium Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Auditorium</label>
          <select
            value={auditorium}
            onChange={(e) => handleChange("auditorium", e.target.value)}
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">All Auditoriums</option>
            {availableAuditoriums.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* Start Date Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => handleChange("startDate", e.target.value)}
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* End Date Filter */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => handleChange("endDate", e.target.value)}
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* Clear Filters Button */}
        <div className="flex items-end">
          <button
            onClick={() =>
              onFilterChange({
                status: "all",
                format: "",
                language: "",
                rating: "",
                auditorium: "",
                startDate: "",
                endDate: "",
              })
            }
            className="w-full rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-800"
          >
            Clear Filters
          </button>
        </div>
      </div>
    </div>
  );
}

