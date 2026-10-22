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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useDebounce } from "~/lib/hooks/useDebounce";
import { errorMessage, type RouterInputs, useTRPC } from "~/lib/trpc";
import { button, column, field, formatDay, formatTime, h1, inlineSelect, page, plural, selectField } from "~/lib/ui";
import { useShell } from "../_components/AppShell";

type ListInput = RouterInputs["showtimes"]["list"];
type AdminRow = Extract<ShowtimeRow, { access: "admin" }>;

interface Filters {
  status: ShowtimeStatus | "all";
  movieStatus: MovieStatus | "";
  format: string;
  language: string;
  rating: string;
  auditorium: string;
  from: string;
  to: string;
}
const noFilters: Filters = {
  status: "all",
  movieStatus: "",
  format: "",
  language: "",
  rating: "",
  auditorium: "",
  from: "",
  to: "",
};

const filterLabels: Record<keyof Filters, string> = {
  status: "Status",
  movieStatus: "Movie status",
  format: "Format",
  language: "Language",
  rating: "Rating",
  auditorium: "Auditorium",
  from: "From",
  to: "To",
};

const dayBoundary = (date: string, end: boolean) =>
  date ? new Date(`${date}T${end ? "23:59:59.999" : "00:00:00"}`).toISOString() : undefined;

const movieStatusLabel: Record<MovieStatus, string> = {
  approved: "Approved",
  draft: "Draft",
  flagged: "Flagged",
  "needs-review": "Needs review",
};
const statusLabel: Record<ShowtimeStatus, string> = { active: "Active", inactive: "Inactive", archived: "Archived" };
const statusDot: Record<ShowtimeStatus, string> = { active: "bg-ink", inactive: "bg-risk", archived: "bg-line-strong" };

export default function ShowtimesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { me, theaters, theaterId, selected, notify } = useShell();

  const [filters, setFilters] = useState<Filters>(noFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounce(search.trim(), 250);
  const [sort, setSort] = useState<ShowtimeSort>("startTime");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const scopeId = theaterId === "all" ? undefined : theaterId;
  const role = scopeId ? me.theaterRoles[scopeId] : undefined;
  const isAdminHere = role === "admin";
  const roles = Object.values(me.theaterRoles);
  const allowAdminSorts = scopeId ? isAdminHere : roles.length > 0 && roles.every((r) => r === "admin");
  const timezones = useMemo(() => Object.fromEntries(theaters.map((t) => [t.id, t.timezone])), [theaters]);

  const input: ListInput = {
    theaterId: scopeId,
    q: q || undefined,
    status: filters.status,
    movieStatus: filters.movieStatus || undefined,
    format: filters.format || undefined,
    language: filters.language || undefined,
    rating: filters.rating || undefined,
    auditorium: filters.auditorium || undefined,
    from: dayBoundary(filters.from, false),
    to: dayBoundary(filters.to, true),
    sort: !allowAdminSorts && ADMIN_ONLY_SORTS.includes(sort) ? "startTime" : sort,
    order,
    limit: 50,
  };
  const list = useInfiniteQuery(
    trpc.showtimes.list.infiniteQueryOptions(input, {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      placeholderData: (prev) => prev,
      enabled: theaters.length > 0,
    }),
  );
  const facets = useQuery({
    ...trpc.showtimes.facets.queryOptions({ theaterId: scopeId }),
    enabled: theaters.length > 0,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const first = list.data?.pages[0];
  const showInternal = facets.data?.canSeeInternal ?? false;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.showtimes.list.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.showtimes.facets.pathKey() }),
    ]);

  const update = useMutation(
    trpc.showtimes.update.mutationOptions({
      onMutate: (v) => setPendingId(v.id),
      onSettled: () => setPendingId(null),
      onSuccess: (row) => {
        notify(`${row.movieTitle} updated.`);
        void refresh();
      },
      onError: (e) => {
        notify(errorMessage(e), "error");
        void refresh();
      },
    }),
  );
  const onUpdate = (row: AdminRow, patch: { movieStatus?: MovieStatus; status?: ShowtimeStatus }) =>
    update.mutate({ id: row.id, expectedVersion: row.version, ...patch });

  const archiveAll = useMutation(
    trpc.showtimes.archiveAll.mutationOptions({
      onSuccess: (r) => {
        notify(`Archived ${plural(r.archived, "showtime")}.`);
        void refresh();
      },
      onError: (e) => notify(errorMessage(e), "error"),
    }),
  );

  const onSort = (field: ShowtimeSort) => {
    if (field === sort) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setOrder("asc");
    }
  };

  const activeFilters = (Object.keys(filters) as (keyof Filters)[]).filter((k) => filters[k] !== noFilters[k]);
  const filtering = activeFilters.length > 0 || q.length > 0;

  if (theaters.length === 0) {
    return (
      <div className={`${column} pt-8`}>
        <h1 className={h1}>No theaters yet</h1>
        <p className="mt-2 text-[15px] text-pretty text-ink-2">
          You&apos;re signed in, but you don&apos;t belong to any theater, so there are no showtimes to show. An admin
          or a super admin can add you to one from People.
        </p>
      </div>
    );
  }

  const subline = [
    selected ? selected.location : `${theaters.length} theaters`,
    scopeId ? (isAdminHere ? "You're an admin here" : "Read-only, active showtimes only") : null,
    first
      ? `${first.totalCapped ? "10,000+" : first.total.toLocaleString()} ${first.total === 1 ? "showtime" : "showtimes"}`
      : null,
  ].filter(Boolean);

  return (
    <div className={`${page} max-w-6xl pt-8 pb-24`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={h1}>{selected?.name ?? "All theaters"}</h1>
          <p className="mt-2 text-[15px] text-ink-2">{subline.join(" · ")}</p>
        </div>
        {isAdminHere && scopeId && (
          <div className="flex items-center gap-1">
            <button
              className={button.quiet}
              disabled={archiveAll.isPending}
              onClick={() => {
                if (
                  confirm(
                    `Archive every showtime at ${selected?.name}? They stay in the database and can be restored by a new import.`,
                  )
                ) {
                  archiveAll.mutate({ theaterId: scopeId });
                }
              }}
            >
              Clear schedule
            </button>
            <Link href="/imports/new" className={button.primary}>
              Import CSV
            </Link>
          </div>
        )}
      </div>

      {!scopeId && roles.includes("admin") && (
        <p className="mt-4 text-[13px] text-ink-2">Choose a single theater in the top left to import a partner CSV.</p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search films, typos are fine"
            aria-label="Search by film title"
            className={`${field} pl-8`}
          />
        </div>
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((s) => !s)}
          className={`${button.secondary} ${activeFilters.length ? "border-ink" : ""}`}
        >
          <SlidersHorizontal aria-hidden className="size-3.5" />
          Filters{activeFilters.length ? ` · ${activeFilters.length}` : ""}
        </button>
        {filtering && (
          <button
            type="button"
            className={button.quiet}
            onClick={() => {
              setFilters(noFilters);
              setSearch("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {showFilters && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {showInternal && (
            <FilterSelect
              label="Status"
              value={filters.status}
              onChange={(v) => setFilters({ ...filters, status: (v || "all") as Filters["status"] })}
              options={SHOWTIME_STATUSES.map((s) => [s, statusLabel[s]])}
              allLabel="Any status"
              allValue="all"
            />
          )}
          {showInternal && (
            <FilterSelect
              label="Movie status"
              value={filters.movieStatus}
              onChange={(v) => setFilters({ ...filters, movieStatus: v as MovieStatus | "" })}
              options={(facets.data?.movieStatuses ?? []).map((s) => [s, movieStatusLabel[s]])}
              allLabel="Any movie status"
            />
          )}
          <FilterSelect
            label="Format"
            value={filters.format}
            onChange={(v) => setFilters({ ...filters, format: v })}
            options={(facets.data?.formats ?? []).map((v) => [v, v])}
            allLabel="Any format"
          />
          <FilterSelect
            label="Language"
            value={filters.language}
            onChange={(v) => setFilters({ ...filters, language: v })}
            options={(facets.data?.languages ?? []).map((v) => [v, v])}
            allLabel="Any language"
          />
          <FilterSelect
            label="Rating"
            value={filters.rating}
            onChange={(v) => setFilters({ ...filters, rating: v })}
            options={(facets.data?.ratings ?? []).map((v) => [v, v])}
            allLabel="Any rating"
          />
          <FilterSelect
            label="Auditorium"
            value={filters.auditorium}
            onChange={(v) => setFilters({ ...filters, auditorium: v })}
            options={(facets.data?.auditoriums ?? []).map((v) => [v, v])}
            allLabel="Any auditorium"
          />
          <label className="block">
            <span className="sr-only">Starts on or after</span>
            <input
              type="date"
              aria-label="Starts on or after"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className={field}
            />
          </label>
          <label className="block">
            <span className="sr-only">Starts on or before</span>
            <input
              type="date"
              aria-label="Starts on or before"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className={field}
            />
          </label>
        </div>
      )}

      {activeFilters.length > 0 && !showFilters && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {activeFilters.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilters({ ...filters, [k]: noFilters[k] })}
              className="inline-flex items-center gap-1 hover:text-ink"
              aria-label={`Remove ${filterLabels[k]} filter`}
            >
              {filterLabels[k]}: <span className="text-ink">{String(filters[k])}</span>
              <X aria-hidden className="size-3" />
            </button>
          ))}
        </div>
      )}

      {list.error && <p className="mt-6 text-[13px] text-remove">{errorMessage(list.error)}</p>}

      {/* Desktop table */}
      <div className="mt-6 hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13px] whitespace-nowrap">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-2">
              {!scopeId && <SortTh label="Theater" field="theaterName" {...{ sort, order, onSort }} />}
              <SortTh label="Film" field="movieTitle" {...{ sort, order, onSort }} />
              {showInternal && (
                <SortTh
                  label="Movie status"
                  field="movieStatus"
                  disabled={!allowAdminSorts}
                  {...{ sort, order, onSort }}
                />
              )}
              <th className="py-2.5 pr-4 font-normal">Auditorium</th>
              <SortTh label="Starts" field="startTime" {...{ sort, order, onSort }} />
              <SortTh label="Ends" field="endTime" {...{ sort, order, onSort }} />
              <th className="py-2.5 pr-4 font-normal">Format</th>
              <th className="py-2.5 pr-4 font-normal">Language</th>
              <th className="py-2.5 pr-4 font-normal">Rating</th>
              {showInternal && <th className="py-2.5 pr-4 font-normal">Status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tz = timezones[row.theaterId];
              const admin = row.access === "admin" ? row : null;
              const busy = pendingId === row.id;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-line transition-colors hover:bg-[#fafafa] ${admin?.status === "archived" ? "text-ink-3" : ""}`}
                >
                  {!scopeId && <td className="py-2.5 pr-4 text-ink-2">{row.theaterName}</td>}
                  <td className="py-2.5 pr-4 font-medium">{row.movieTitle}</td>
                  {showInternal && (
                    <td className="py-1.5 pr-4">
                      {admin ? (
                        <select
                          aria-label={`Movie status for ${row.movieTitle}`}
                          value={admin.movieStatus}
                          disabled={busy}
                          onChange={(e) => onUpdate(admin, { movieStatus: e.target.value as MovieStatus })}
                          className={inlineSelect}
                        >
                          {MOVIE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {movieStatusLabel[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-ink-3">Hidden</span>
                      )}
                    </td>
                  )}
                  <td className="py-2.5 pr-4">{row.auditorium}</td>
                  <td className="tnum py-2.5 pr-4 whitespace-nowrap">
                    <span className="text-ink-2">{formatDay(row.startTime, tz)}</span>&nbsp;{" "}
                    {formatTime(row.startTime, tz)}
                  </td>
                  <td className="tnum py-2.5 pr-4 whitespace-nowrap">{formatTime(row.endTime, tz)}</td>
                  <td className="py-2.5 pr-4">{row.format}</td>
                  <td className="py-2.5 pr-4">{row.language}</td>
                  <td className="py-2.5 pr-4">{row.rating}</td>
                  {showInternal && (
                    <td className="py-1.5 pr-4">
                      {admin ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className={`size-1.5 rounded-full ${statusDot[admin.status]}`} />
                          <select
                            aria-label={`Status for ${row.movieTitle}`}
                            value={admin.status}
                            disabled={busy}
                            onChange={(e) => onUpdate(admin, { status: e.target.value as ShowtimeStatus })}
                            className={inlineSelect}
                          >
                            {SHOWTIME_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {statusLabel[s]}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : (
                        <span className="text-ink-3">Hidden</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone list */}
      <ul className="mt-6 border-t border-line md:hidden">
        {rows.map((row) => {
          const tz = timezones[row.theaterId];
          const admin = row.access === "admin" ? row : null;
          return (
            <li
              key={row.id}
              className={`border-b border-line py-3 ${admin?.status === "archived" ? "text-ink-3" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{row.movieTitle}</span>
                <span className="tnum shrink-0 text-[13px]">{formatTime(row.startTime, tz)}</span>
              </div>
              <div className="mt-0.5 text-[13px] text-ink-2">
                {[
                  !scopeId ? row.theaterName : null,
                  row.auditorium,
                  formatDay(row.startTime, tz),
                  row.format,
                  row.rating,
                  admin ? `${statusLabel[admin.status]}, ${movieStatusLabel[admin.movieStatus].toLowerCase()}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </li>
          );
        })}
      </ul>

      {!list.isPending && rows.length === 0 && (
        <div className="py-16 text-center">
          <p className="font-medium">{filtering ? "No showtimes match" : "No showtimes yet"}</p>
          <p className="mt-1 text-[13px] text-ink-2">
            {filtering
              ? "Try a different spelling or clear the filters."
              : isAdminHere
                ? "Import a partner CSV to fill the schedule."
                : "Nothing is scheduled here right now."}
          </p>
        </div>
      )}
      {list.isPending && (
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-wash" />
          ))}
        </div>
      )}

      {list.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <button className={button.secondary} onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage
              ? "Loading…"
              : `Show more (${rows.length} of ${first?.totalCapped ? "10,000+" : first?.total})`}
          </button>
        </div>
      )}
    </div>
  );
}

function SortTh({
  label,
  field,
  sort,
  order,
  onSort,
  disabled,
}: {
  label: string;
  field: ShowtimeSort;
  sort: ShowtimeSort;
  order: "asc" | "desc";
  onSort: (f: ShowtimeSort) => void;
  disabled?: boolean;
}) {
  const active = sort === field;
  if (disabled) return <th className="py-2.5 pr-4 font-normal">{label}</th>;
  const Icon = active && order === "desc" ? ChevronDown : ChevronUp;
  return (
    <th
      className="py-1.5 pr-4 font-normal"
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-wash hover:text-ink ${active ? "text-ink" : ""}`}
      >
        {label}
        <Icon aria-hidden className={`size-3 ${active ? "opacity-100" : "opacity-0"}`} />
      </button>
    </th>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  allValue = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  allLabel: string;
  allValue?: string;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={selectField}>
        <option value={allValue}>{allLabel}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
