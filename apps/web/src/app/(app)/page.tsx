"use client";

import type { ImportDetail, MovieStatus, ShowtimeSort, ShowtimeStatus } from "@scope/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebounce } from "~/lib/hooks/useDebounce";
import { errorMessage, httpStatusOf, type RouterInputs, useTRPC } from "~/lib/trpc";
import { dangerButton, inputClass, panelClass, secondaryButton } from "~/lib/ui";
import { useMe } from "../_components/AppShell";
import { FileUpload } from "../_components/FileUpload";
import { emptyFilters, FilterBar, type Filters } from "../_components/FilterBar";
import { PreviewModal } from "../_components/PreviewModal";
import { ShowtimesTable } from "../_components/ShowtimesTable";

type ListInput = RouterInputs["showtimes"]["list"];

/** Local calendar date -> ISO instant at the start (or end) of that day. */
const dayBoundary = (date: string, end: boolean) =>
  date ? new Date(`${date}T${end ? "23:59:59.999" : "00:00:00"}`).toISOString() : undefined;

export default function ShowtimesPage() {
  const trpc = useTRPC();
  const me = useMe();
  const queryClient = useQueryClient();

  const [theaterId, setTheaterId] = useState<string>("all");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [search, setSearch] = useState("");
  const q = useDebounce(search.trim(), 300);
  const [sort, setSort] = useState<ShowtimeSort>("startTime");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportDetail | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const theaters = useQuery(trpc.theaters.list.queryOptions());
  const scopeId = theaterId === "all" ? undefined : theaterId;
  const role = scopeId ? me.theaterRoles[scopeId] : undefined;
  const isAdminHere = role === "admin";
  const allAdmin =
    Object.values(me.theaterRoles).length > 0 && Object.values(me.theaterRoles).every((r) => r === "admin");
  const allowAdminSorts = scopeId ? isAdminHere : allAdmin;
  const timezones = useMemo(
    () => Object.fromEntries((theaters.data ?? []).map((t) => [t.id, t.timezone])),
    [theaters.data],
  );

  const input: ListInput = {
    theaterId: scopeId,
    q: q || undefined,
    status: filters.status,
    movieStatus: filters.movieStatus || undefined,
    format: filters.format || undefined,
    language: filters.language || undefined,
    rating: filters.rating || undefined,
    auditorium: filters.auditorium || undefined,
    from: dayBoundary(filters.startDate, false),
    to: dayBoundary(filters.endDate, true),
    sort,
    order,
    limit: 50,
  };
  const list = useInfiniteQuery(
    trpc.showtimes.list.infiniteQueryOptions(input, {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      placeholderData: (prev) => prev,
    }),
  );
  const facets = useQuery(trpc.showtimes.facets.queryOptions({ theaterId: scopeId }));
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const firstPage = list.data?.pages[0];

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.showtimes.list.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.showtimes.facets.pathKey() }),
    ]);

  const update = useMutation(
    trpc.showtimes.update.mutationOptions({
      onMutate: (v) => setPendingId(v.id),
      onSettled: () => setPendingId(null),
      onSuccess: () => refresh(),
      onError: (e) => {
        setBanner({ tone: "error", text: errorMessage(e) });
        void refresh();
      },
    }),
  );
  const onUpdate = (
    row: { id: string; version: number },
    patch: { movieStatus?: MovieStatus; status?: ShowtimeStatus },
  ) => {
    setBanner(null);
    update.mutate({ id: row.id, expectedVersion: row.version, ...patch });
  };

  const archiveAll = useMutation(
    trpc.showtimes.archiveAll.mutationOptions({
      onSuccess: (r) => {
        setBanner({ tone: "ok", text: `Archived ${r.archived} showtimes.` });
        void refresh();
      },
      onError: (e) => setBanner({ tone: "error", text: errorMessage(e) }),
    }),
  );

  const createImport = useMutation(
    trpc.imports.create.mutationOptions({
      onSuccess: (detail) => setPreview(detail),
      onError: (e) => setBanner({ tone: "error", text: `Upload failed: ${errorMessage(e)}` }),
    }),
  );
  const commit = useMutation(
    trpc.imports.commit.mutationOptions({
      onSuccess: (detail) => {
        setPreview(detail);
        const s = detail.summary;
        setBanner({
          tone: "ok",
          text: `Import applied: ${s.addCount} added, ${s.updateCount} updated, ${s.archiveCount} archived.`,
        });
        void refresh();
      },
    }),
  );
  const discard = useMutation(
    trpc.imports.discard.mutationOptions({
      onSuccess: () => {
        setPreview(null);
        setBanner({ tone: "ok", text: "Import discarded. Nothing changed." });
      },
    }),
  );

  const onSort = (field: ShowtimeSort) => {
    if (field === sort) setOrder(order === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setOrder("asc");
    }
  };

  const theaterList = theaters.data ?? [];
  const selected = theaterList.find((t) => t.id === scopeId);
  const noTheaters = theaters.isSuccess && theaterList.length === 0;

  return (
    <>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-white">Showtimes</h1>
        <p className="text-gray-400">
          {noTheaters
            ? "You don't belong to any theaters yet."
            : selected
              ? `${selected.name} · ${selected.location} · you're ${isAdminHere ? "an admin" : "a viewer"} here`
              : `${theaterList.length} theater${theaterList.length === 1 ? "" : "s"} you can see`}
        </p>
      </div>

      {noTheaters ? (
        <div className={`${panelClass} p-8 text-center text-gray-400`}>
          Ask an admin or super admin to add you to a theater.
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">Theater</span>
              <select
                value={theaterId}
                onChange={(e) => {
                  setTheaterId(e.target.value);
                  setBanner(null);
                  if (!allowAdminSortsFor(e.target.value)) setSort("startTime");
                }}
                className={`${inputClass} min-w-56`}
              >
                <option value="all">All my theaters</option>
                {theaterList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.myRole})
                  </option>
                ))}
              </select>
            </label>
            {isAdminHere && scopeId && (
              <>
                <FileUpload
                  busy={createImport.isPending}
                  onError={(text) => setBanner({ tone: "error", text })}
                  onFile={({ name, base64 }) => {
                    setBanner(null);
                    commit.reset();
                    createImport.mutate({ theaterId: scopeId, filename: name, contentBase64: base64 });
                  }}
                />
                <button
                  className={dangerButton}
                  disabled={archiveAll.isPending}
                  onClick={() => {
                    if (confirm(`Archive every showtime at ${selected?.name}? This can't be undone in one click.`)) {
                      archiveAll.mutate({ theaterId: scopeId });
                    }
                  }}
                >
                  Clear schedule
                </button>
              </>
            )}
            <div className="ml-auto text-sm text-gray-400">
              {firstPage &&
                `${firstPage.totalCapped ? "10,000+" : firstPage.total.toLocaleString()} showtime${firstPage.total === 1 ? "" : "s"}`}
            </div>
          </div>

          {!scopeId && Object.values(me.theaterRoles).includes("admin") && (
            <p className="mb-4 text-sm text-gray-500">Pick one theater to upload a CSV or clear its schedule.</p>
          )}
          {role === "viewer" && (
            <div className={`${panelClass} mb-6 p-4 text-sm text-gray-400`}>
              You have read-only access to this theater. You see active showtimes only.
            </div>
          )}
          {banner && (
            <div
              role="status"
              className={`mb-6 flex items-start justify-between gap-4 rounded-lg border p-4 text-sm ${
                banner.tone === "ok"
                  ? "border-green-800 bg-green-950/40 text-green-200"
                  : "border-red-800 bg-red-950/40 text-red-200"
              }`}
            >
              <span>{banner.text}</span>
              <button onClick={() => setBanner(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss">
                ×
              </button>
            </div>
          )}

          <FilterBar
            filters={filters}
            onChange={setFilters}
            facets={
              facets.data ?? {
                formats: [],
                languages: [],
                ratings: [],
                auditoriums: [],
                movieStatuses: [],
                canSeeInternal: false,
              }
            }
          />

          <div className={`${panelClass} p-4 sm:p-6`}>
            <input
              type="search"
              placeholder="Search by movie title (typos are OK)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} mb-4`}
              aria-label="Search by movie title"
            />
            {list.error && <p className="mb-4 text-sm text-red-400">{errorMessage(list.error)}</p>}
            <ShowtimesTable
              rows={rows}
              timezones={timezones}
              showTheaterColumn={!scopeId}
              showInternalColumns={facets.data?.canSeeInternal ?? false}
              allowAdminSorts={allowAdminSorts}
              sort={sort}
              order={order}
              onSort={onSort}
              onUpdate={onUpdate}
              pendingId={pendingId}
              isLoading={list.isPending}
            />
            {list.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <button
                  className={secondaryButton}
                  onClick={() => list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                >
                  {list.isFetchingNextPage ? "Loading…" : `Load more (${rows.length} of ${firstPage?.total ?? "?"})`}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {preview && (
        <PreviewModal
          detail={preview}
          timezone={timezones[preview.summary.theaterId]}
          isApplying={commit.isPending || discard.isPending}
          error={commit.error ? errorMessage(commit.error) : discard.error ? errorMessage(discard.error) : null}
          onApply={(confirmLargeArchive) => commit.mutate({ id: preview.summary.id, confirmLargeArchive })}
          onDiscard={() => discard.mutate({ id: preview.summary.id })}
          onClose={() => {
            // Closing an un-applied preview leaves it to expire; nothing changes.
            setPreview(null);
            commit.reset();
            if (httpStatusOf(commit.error) === 409) void refresh();
          }}
        />
      )}
    </>
  );

  function allowAdminSortsFor(id: string) {
    return id === "all" ? allAdmin : me.theaterRoles[id] === "admin";
  }
}
