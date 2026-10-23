"use client";

import { ChangePasswordInput, theatersWhere } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, httpStatusOf, type RouterOutputs, useTRPC } from "~/lib/trpc";
import { button, field, page } from "~/lib/ui";

export type Me = RouterOutputs["me"]["get"];
export type TheaterOption = RouterOutputs["theaters"]["list"][number];

interface ShellContext {
  me: Me;
  theaters: TheaterOption[];
  /** "all" or a theater id; shared by every page so switching pages keeps your place. */
  theaterId: string;
  setTheaterId: (id: string) => void;
  selected: TheaterOption | undefined;
  /** Shows a short message in the shell's status line. */
  notify: (text: string, tone?: "ok" | "error") => void;
}

const Ctx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell outside AppShell");
  return v;
}

export function principalOf(me: Me) {
  return { userId: me.id, isSuperAdmin: me.isSuperAdmin, theaterRoles: me.theaterRoles };
}

/** Per user, so switching demo roles in one browser doesn't carry a theater across accounts. */
const storageKey = (userId: string) => `showtimes.theater.${userId}`;

export function AppShell({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const router = useRouter();
  const me = useQuery(trpc.me.get.queryOptions());
  const theaters = useQuery({ ...trpc.theaters.list.queryOptions(), enabled: me.isSuccess });
  const [theaterId, setTheaterIdState] = useState("all");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error"; key: number } | null>(null);

  const unauthorized = httpStatusOf(me.error) === 401;
  useEffect(() => {
    if (unauthorized) router.replace("/login");
  }, [unauthorized, router]);

  // Restore the last theater once we know which ones this user can see.
  // "All theaters" only exists as an option with two or more.
  const userId = me.data?.id;
  useEffect(() => {
    if (!theaters.data || !userId) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey(userId));
    } catch {
      stored = null;
    }
    const ids = theaters.data.map((t) => t.id);
    if (stored && ids.includes(stored)) setTheaterIdState(stored);
    else if (ids.length === 1) setTheaterIdState(ids[0]!);
    else setTheaterIdState("all");
  }, [theaters.data, userId]);

  const setTheaterId = useCallback(
    (id: string) => {
      setTheaterIdState(id);
      if (!userId) return;
      try {
        window.localStorage.setItem(storageKey(userId), id);
      } catch {
        // private mode: the choice just won't persist
      }
    },
    [userId],
  );

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "error" ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo<ShellContext | null>(() => {
    if (!me.data) return null;
    const list = theaters.data ?? [];
    return {
      me: me.data,
      theaters: list,
      theaterId,
      setTheaterId,
      selected: list.find((t) => t.id === theaterId),
      notify,
    };
  }, [me.data, theaters.data, theaterId, setTheaterId, notify]);

  if (me.isPending || unauthorized) return <ShellSkeleton />;
  if (me.error || !value) {
    return (
      <div className={`${page} max-w-xl py-24`}>
        <p className="text-[15px] font-medium">We couldn&apos;t load your account.</p>
        <p className="mt-1 text-ink-2">{errorMessage(me.error)}</p>
      </div>
    );
  }

  return (
    <Ctx.Provider value={value}>
      <div className="flex min-h-dvh flex-col">
        <TopBar />
        <main className="flex-1">{value.me.mustChangePassword ? <ForcePasswordChange /> : children}</main>
      </div>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        {toast && (
          <div
            key={toast.key}
            role="status"
            className={`toast-in pointer-events-auto max-w-lg rounded-lg px-4 py-2.5 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.12)] ${
              toast.tone === "error" ? "bg-remove text-white" : "bg-ink text-white"
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="h-14 border-b border-line" />
      <div className={`${page} max-w-5xl pt-12`}>
        <div className="h-8 w-56 animate-pulse rounded bg-wash" />
        <div className="mt-3 h-4 w-80 animate-pulse rounded bg-wash" />
      </div>
    </div>
  );
}

function TopBar() {
  const { me, theaters, theaterId, setTheaterId } = useShell();
  const pathname = usePathname();
  if (me.mustChangePassword) {
    // Nothing else is reachable until the password is set, so the bar stays empty.
    return (
      <header className="sticky top-0 z-40 border-b border-line bg-white">
        <div className="flex h-14 items-center px-4 sm:px-5">
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Showtimes</span>
        </div>
      </header>
    );
  }
  const p = principalOf(me);
  const nav = [
    { href: "/", label: "Showtimes", show: true },
    { href: "/imports", label: "Imports", show: theatersWhere(p, "import.manage").length > 0 },
    { href: "/people", label: "People", show: me.isSuperAdmin || theatersWhere(p, "member.read").length > 0 },
    { href: "/audit", label: "Audit log", show: me.isSuperAdmin || theatersWhere(p, "audit.read").length > 0 },
  ].filter((n) => n.show);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  // Reviewing an import is a focus task: the bar keeps only the theater and you.
  const focus = /^\/imports\/(?!new$)[^/]+$/.test(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 supports-[backdrop-filter]:bg-white/85 supports-[backdrop-filter]:backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-5">
        <div className="relative min-w-0">
          <label htmlFor="theater-switcher" className="sr-only">
            Theater
          </label>
          <select
            id="theater-switcher"
            value={theaterId}
            onChange={(e) => setTheaterId(e.target.value)}
            disabled={theaters.length === 0}
            className="[field-sizing:content] max-w-[46vw] cursor-pointer appearance-none truncate rounded-md py-1.5 pr-6 pl-1.5 text-[14px] font-semibold tracking-[-0.01em] hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus sm:max-w-none"
          >
            {theaters.length === 0 && <option value="all">No theaters</option>}
            {theaters.length > 1 && <option value="all">All theaters</option>}
            {theaters.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-1 size-3.5 -translate-y-1/2 text-ink-3"
          />
        </div>

        <nav aria-label="Main" className={`ml-3 hidden items-center gap-0.5 ${focus ? "" : "sm:flex"}`}>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                active(n.href) ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {focus && (
            <Link
              href="/imports"
              className="rounded-md px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-wash hover:text-ink"
            >
              Close
            </Link>
          )}
          <UserMenu nav={nav} focus={focus} />
        </div>
      </div>
    </header>
  );
}

function roleSummary(me: Me) {
  if (me.isSuperAdmin) return "Super admin";
  const roles = Object.values(me.theaterRoles);
  if (roles.length === 0) return "No theaters";
  const admin = roles.filter((r) => r === "admin").length;
  const viewer = roles.length - admin;
  if (admin && viewer) return "Admin and viewer";
  return admin ? "Admin" : "Viewer";
}

function UserMenu({ nav, focus }: { nav: { href: string; label: string }[]; focus: boolean }) {
  const { me, notify } = useShell();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const demo = useQuery(trpc.auth.devAccounts.queryOptions());

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logout = useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        router.replace("/login");
      },
    }),
  );
  const reset = useMutation(
    trpc.demo.reset.mutationOptions({
      onSuccess: async (r) => {
        await queryClient.invalidateQueries();
        notify(`Demo data restored: ${r.showtimes} showtimes, imports cleared.`);
      },
      onError: (e) => notify(errorMessage(e), "error"),
    }),
  );

  const item =
    "flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-wash disabled:opacity-50";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-2.5 text-right transition-colors hover:bg-wash"
      >
        <span className="leading-tight">
          <span className="block text-[13px] font-medium">{me.name}</span>
          <span className="block text-[12px] text-ink-2">{roleSummary(me)}</span>
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-ink-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="menu-in absolute right-0 mt-1.5 w-60 origin-top-right rounded-lg border border-line bg-white p-1 shadow-[0_12px_32px_rgba(0,0,0,0.10)]"
        >
          <div className="px-2.5 pt-2 pb-2.5 text-[12px] text-ink-2">{me.email}</div>
          <div className={focus ? "" : "sm:hidden"}>
            {nav.map((n) => (
              <Link key={n.href} href={n.href} role="menuitem" className={item} onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ))}
            <div className="my-1 h-px bg-line" />
          </div>
          <button role="menuitem" className={item} onClick={() => logout.mutate(undefined)}>
            Switch role
          </button>
          {(demo.data?.length ?? 0) > 0 && me.isSuperAdmin && (
            <button
              role="menuitem"
              className={item}
              disabled={reset.isPending}
              onClick={() => {
                if (
                  confirm(
                    "Restore the original demo schedule and clear every import? Everyone using the demo shares this data.",
                  )
                ) {
                  setOpen(false);
                  reset.mutate(undefined);
                }
              }}
            >
              {reset.isPending ? "Restoring…" : "Reset demo data"}
            </button>
          )}
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" className={item} onClick={() => logout.mutate(undefined)}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ForcePasswordChange() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({ onSuccess: () => queryClient.invalidateQueries() }),
  );
  return (
    <div className={`${page} max-w-sm pt-8 pb-20`}>
      <h1 className="text-[28px] leading-[1.12] font-bold tracking-[-0.03em]">Set your password</h1>
      <p className="mt-1.5 text-ink-2">You signed in with a temporary password. Choose your own to continue.</p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = ChangePasswordInput.safeParse({ currentPassword, newPassword });
          if (!parsed.success) return setLocalError(parsed.error.issues[0]?.message ?? "Check the form");
          setLocalError(null);
          change.mutate(parsed.data);
        }}
      >
        <input
          className={field}
          type="password"
          aria-label="Temporary password"
          placeholder="Temporary password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className={field}
          type="password"
          aria-label="New password"
          placeholder="New password, 12+ characters"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        {(localError ?? change.error) && (
          <p className="text-[13px] text-remove">{localError ?? errorMessage(change.error)}</p>
        )}
        <button className={`${button.primary} w-full`} disabled={change.isPending}>
          Save password
        </button>
      </form>
    </div>
  );
}
