"use client";

import type { AppRouter, RouterInputs, RouterOutputs } from "@scope/api/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  isNonJsonSerializable,
  splitLink,
  TRPCClientError,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";

export type { RouterInputs, RouterOutputs };

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function httpStatusOf(error: unknown): number | undefined {
  return error instanceof TRPCClientError ? (error.data as { httpStatus?: number } | undefined)?.httpStatus : undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof TRPCClientError) {
    const zod = (error.data as { zodError?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } })
      ?.zodError;
    const first = zod?.formErrors?.[0] ?? Object.values(zod?.fieldErrors ?? {})[0]?.[0];
    return first ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            // Don't retry auth or permission failures.
            retry: (count, error) => {
              const status = httpStatusOf(error);
              if (status && status < 500) return false;
              return count < 2;
            },
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        // Big CSV uploads go alone; everything else is batched.
        splitLink({
          condition: (op) => op.path === "imports.create" || isNonJsonSerializable(op.input),
          true: httpLink({ url: "/trpc" }),
          false: httpBatchLink({ url: "/trpc" }),
        }),
      ],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
