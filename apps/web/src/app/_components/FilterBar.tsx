"use client";

import type { MovieStatus, ShowtimeStatus } from "@scope/shared";
import { inputClass, panelClass, secondaryButton } from "~/lib/ui";

export interface Filters {
  status: ShowtimeStatus | "all";
  format: string;
  language: string;
  rating: string;
  auditorium: string;
  movieStatus: MovieStatus | "";
  startDate: string;
  endDate: string;
}

export const emptyFilters: Filters = {
  status: "all",
  format: "",
  language: "",
  rating: "",
  auditorium: "",
  movieStatus: "",
  startDate: "",
  endDate: "",
};

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  facets: {
    formats: string[];
    languages: string[];
    ratings: string[];
    auditoriums: string[];
    movieStatuses: MovieStatus[];
    canSeeInternal: boolean;
  };
}

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  allLabel: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({ filters, onChange, facets }: Props) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const active = Object.entries(filters).filter(([k, v]) => v !== emptyFilters[k as keyof Filters]).length;

  return (
    <div className={`${panelClass} mb-6 p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">Filters{active ? ` · ${active} on` : ""}</h3>
        <button className={secondaryButton} disabled={!active} onClick={() => onChange(emptyFilters)}>
          Clear filters
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {facets.canSeeInternal && (
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">Showtime status</span>
            <select
              value={filters.status}
              onChange={(e) => set("status", e.target.value as Filters["status"])}
              className={inputClass}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}
        {facets.canSeeInternal && (
          <Select
            label="Movie status"
            value={filters.movieStatus}
            onChange={(v) => set("movieStatus", v as Filters["movieStatus"])}
            options={facets.movieStatuses}
            allLabel="All movie statuses"
          />
        )}
        <Select
          label="Format"
          value={filters.format}
          onChange={(v) => set("format", v)}
          options={facets.formats}
          allLabel="All formats"
        />
        <Select
          label="Language"
          value={filters.language}
          onChange={(v) => set("language", v)}
          options={facets.languages}
          allLabel="All languages"
        />
        <Select
          label="Rating"
          value={filters.rating}
          onChange={(v) => set("rating", v)}
          options={facets.ratings}
          allLabel="All ratings"
        />
        <Select
          label="Auditorium"
          value={filters.auditorium}
          onChange={(v) => set("auditorium", v)}
          options={facets.auditoriums}
          allLabel="All auditoriums"
        />
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Starts on or after</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Starts on or before</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
    </div>
  );
}
