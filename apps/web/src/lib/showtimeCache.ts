import type { ShowtimeRow } from "@scope/shared";
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { RouterOutputs } from "./trpc";

type ListPage = RouterOutputs["showtimes"]["list"];

/** Rewrites one showtime in every cached page of the showtimes list, so edits show without a refetch. */
export function patchShowtimeRows(
  queryClient: QueryClient,
  listKey: QueryKey,
  id: string,
  patch: (row: ShowtimeRow) => ShowtimeRow,
) {
  queryClient.setQueriesData<InfiniteData<ListPage>>({ queryKey: listKey }, (data) =>
    data?.pages
      ? {
          ...data,
          pages: data.pages.map((p) => ({ ...p, items: p.items.map((r) => (r.id === id ? patch(r) : r)) })),
        }
      : data,
  );
}
