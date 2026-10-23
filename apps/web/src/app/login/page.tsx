"use client";

import { LoginInput } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { button, field } from "~/lib/ui";

const DEMO_PASSWORD = "showtimes-dev-pass";

/** Turns "admin · Downtown, viewer · Uptown" into a sentence a reviewer can scan. */
function describe(summary: string) {
  if (summary.startsWith("Super admin")) return "Admin of every theater, manages people, can reset the demo";
  if (summary === "No theaters") return "Belongs to no theaters, sees an empty console";
  const parts = summary.split(", ").map((p) => p.split(" · "));
  const admin = parts.filter(([r]) => r === "admin").map(([, t]) => t);
  const viewer = parts.filter(([r]) => r === "viewer").map(([, t]) => t);
  const list = (xs: (string | undefined)[]) =>
    xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  if (admin.length && viewer.length) return `Admin at ${list(admin)}, viewer at ${list(viewer)}`;
  if (admin.length) return `Admin at ${list(admin)}`;
  return `Read-only at ${list(viewer)}`;
}

export default function LoginPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const accounts = useQuery(trpc.auth.devAccounts.queryOptions());
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        router.replace("/");
      },
      onSettled: () => setPending(null),
    }),
  );

  const submit = (values: { email: string; password: string }) => {
    const parsed = LoginInput.safeParse(values);
    if (!parsed.success) return setLocalError("Enter your email and password.");
    setLocalError(null);
    setPending(values.email);
    login.mutate(parsed.data);
  };

  const demo = accounts.data ?? [];
  const error = localError ?? (login.error ? errorMessage(login.error) : null);

  return (
    <main className="min-h-dvh">
      <div className="flex h-14 items-center px-5 sm:px-6">
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Showtimes</span>
      </div>
      <div className="mx-auto flex w-full max-w-[480px] flex-col px-5 pt-[8vh] pb-16">
        {demo.length > 0 ? (
          <>
            <h1 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] text-balance sm:text-[34px]">
              Choose a role to explore
            </h1>
            <p className="mt-2.5 text-[14px] text-pretty text-ink-2">
              Each account signs you in with its own access, so you can see what an admin, a viewer and a super admin
              each get.
            </p>

            <ul className="mt-8 border-t border-line">
              {demo.map((a) => {
                const isPending = pending === a.email;
                return (
                  <li key={a.email} className="border-b border-line">
                    <button
                      type="button"
                      disabled={login.isPending}
                      onClick={() => submit({ email: a.email, password: DEMO_PASSWORD })}
                    aria-label={`Sign in as ${a.name}: ${describe(a.summary)}`}
                      className="group flex w-full items-center gap-4 py-3.5 text-left transition-colors disabled:cursor-wait"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                          {a.name}
                        </span>
                        <span className="block truncate text-[13px] text-ink-2">{describe(a.summary)}</span>
                      </span>
                      {isPending && <Loader2 aria-label="Signing in" className="size-4 animate-spin text-ink-3" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <h1 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em] sm:text-[34px]">Sign in</h1>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-remove">
            {error}
          </p>
        )}

        {demo.length > 0 && !showForm ? (
          <button type="button" onClick={() => setShowForm(true)} className={`${button.link} mt-6 self-start`}>
            Sign in with email instead
          </button>
        ) : (
          <form
            className="mt-8 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit({ email, password });
            }}
          >
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium">
                Email
              </label>
              <input
                id="email"
                className={field}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium">
                Password
              </label>
              <input
                id="password"
                className={field}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className={`${button.primary} w-full`} disabled={login.isPending}>
              {login.isPending && pending === email ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
