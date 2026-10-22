"use client";

import { LoginInput } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { inputClass, panelClass, primaryButton } from "~/lib/ui";

const DEV_PASSWORD = "showtimes-dev-pass";

export default function LoginPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const devAccounts = useQuery(trpc.auth.devAccounts.queryOptions());
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        router.replace("/");
      },
    }),
  );

  const submit = (values: { email: string; password: string }) => {
    const parsed = LoginInput.safeParse(values);
    if (!parsed.success) return setLocalError("Enter a valid email and password");
    setLocalError(null);
    login.mutate(parsed.data);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-b from-night-900 to-night-950 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className={`${panelClass} p-6`}>
          <h1 className="text-2xl font-bold text-white">Theater Showtimes Manager</h1>
          <p className="mt-1 text-sm text-gray-400">Sign in to see the schedules for your theaters.</p>
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit({ email, password });
            }}
          >
            <label className="block text-xs text-gray-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={inputClass}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="block text-xs text-gray-400" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {(localError ?? login.error) && (
              <p className="text-sm text-red-400">{localError ?? errorMessage(login.error)}</p>
            )}
            <button className={`${primaryButton} w-full`} disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        {devAccounts.data && devAccounts.data.length > 0 && (
          <div className={`${panelClass} p-4`}>
            <p className="text-sm font-medium text-gray-300">Demo accounts</p>
            <p className="mb-3 text-xs text-gray-500">Click one to sign in as that role. Password: {DEV_PASSWORD}</p>
            <ul className="divide-y divide-gray-800">
              {devAccounts.data.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    disabled={login.isPending}
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEV_PASSWORD);
                      submit({ email: a.email, password: DEV_PASSWORD });
                    }}
                    className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm transition hover:bg-gray-800"
                  >
                    <span className="text-white">{a.name}</span>
                    <span className="text-right text-xs text-gray-400">{a.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
