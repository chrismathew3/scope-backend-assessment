"use client";

import { ChangePasswordInput, theatersWhere } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { errorMessage, httpStatusOf, type RouterOutputs, useTRPC } from "~/lib/trpc";
import { inputClass, panelClass, primaryButton, secondaryButton } from "~/lib/ui";

export type Me = RouterOutputs["me"]["get"];

const MeContext = createContext<Me | null>(null);

/** The signed-in user. Only usable inside <AppShell>. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside AppShell");
  return me;
}

/** Principal shape for the shared permission helpers. */
export function principalOf(me: Me) {
  return { userId: me.id, isSuperAdmin: me.isSuperAdmin, theaterRoles: me.theaterRoles };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useQuery(trpc.me.get.queryOptions());
  const logout = useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace("/login");
      },
    }),
  );

  const unauthorized = httpStatusOf(me.error) === 401;
  useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [unauthorized, router]);

  if (me.isPending || unauthorized) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>;
  }
  if (me.error) {
    return <div className="p-8 text-red-400">Couldn&apos;t load your account: {errorMessage(me.error)}</div>;
  }

  const user = me.data;
  const p = principalOf(user);
  const canManagePeople = user.isSuperAdmin || theatersWhere(p, "member.read").length > 0;
  const canSeeAudit = user.isSuperAdmin || theatersWhere(p, "audit.read").length > 0;
  const nav = [
    { href: "/", label: "Showtimes", show: true },
    { href: "/people", label: "People", show: canManagePeople },
    { href: "/audit", label: "Audit log", show: canSeeAudit },
  ];
  const roleSummary = user.isSuperAdmin
    ? "Super admin · all theaters"
    : Object.keys(user.theaterRoles).length === 0
      ? "No theaters"
      : `${Object.values(user.theaterRoles).filter((r) => r === "admin").length} admin · ${
          Object.values(user.theaterRoles).filter((r) => r === "viewer").length
        } viewer`;

  return (
    <MeContext.Provider value={user}>
      <main className="min-h-screen bg-linear-to-b from-night-900 to-night-950">
        <header className="border-b border-gray-800">
          <div className="container mx-auto flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
            <Link href="/" className="text-lg font-bold text-white">
              Showtimes
            </Link>
            <nav className="flex gap-1">
              {nav
                .filter((n) => n.show)
                .map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`rounded-md px-3 py-1.5 text-sm transition ${
                      pathname === n.href ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {n.label}
                  </Link>
                ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <div className="text-right">
                <div className="text-white">{user.name}</div>
                <div className="text-xs text-gray-500">{roleSummary}</div>
              </div>
              <button className={secondaryButton} onClick={() => logout.mutate(undefined)} disabled={logout.isPending}>
                Sign out
              </button>
            </div>
          </div>
        </header>
        <div className="container mx-auto px-4 py-8">
          {user.mustChangePassword ? <ForcePasswordChange /> : children}
        </div>
      </main>
    </MeContext.Provider>
  );
}

function ForcePasswordChange() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  );
  return (
    <div className={`${panelClass} mx-auto max-w-md p-6`}>
      <h1 className="text-xl font-semibold text-white">Set your password</h1>
      <p className="mt-1 text-sm text-gray-400">
        Your account was created with a temporary password. Choose your own to continue.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = ChangePasswordInput.safeParse({ currentPassword, newPassword });
          if (!parsed.success) return setLocalError(parsed.error.issues[0]?.message ?? "Invalid");
          setLocalError(null);
          change.mutate(parsed.data);
        }}
      >
        <input
          className={inputClass}
          type="password"
          placeholder="Temporary password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className={inputClass}
          type="password"
          placeholder="New password (12+ characters)"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        {(localError ?? change.error) && (
          <p className="text-sm text-red-400">{localError ?? errorMessage(change.error)}</p>
        )}
        <button className={`${primaryButton} w-full`} disabled={change.isPending}>
          Save password
        </button>
      </form>
    </div>
  );
}
