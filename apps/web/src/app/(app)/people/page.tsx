"use client";

import { can, type TheaterRole, UserCreateInput, type UserView } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, type RouterOutputs, useTRPC } from "~/lib/trpc";
import { inputClass, panelClass, primaryButton, secondaryButton, smallSelectClass } from "~/lib/ui";
import { principalOf, useMe } from "../../_components/AppShell";

type Theater = RouterOutputs["theaters"]["list"][number];

/** Roles the caller may grant in a theater: super admins any, theater admins viewer only. */
function grantableRoles(me: ReturnType<typeof useMe>, theaterId: string): TheaterRole[] {
  const p = principalOf(me);
  if (me.isSuperAdmin) return ["admin", "viewer"];
  return can(p, "member.manageViewers", theaterId) ? ["viewer"] : [];
}

export default function PeoplePage() {
  const trpc = useTRPC();
  const me = useMe();
  const queryClient = useQueryClient();
  const [theaterFilter, setTheaterFilter] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; secret?: string } | null>(null);

  const theaters = useQuery(trpc.theaters.list.queryOptions());
  const users = useQuery(trpc.users.list.queryOptions({ theaterId: theaterFilter || undefined }));
  const manageable = (theaters.data ?? []).filter((t) => grantableRoles(me, t.id).length > 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.users.pathKey() });
  const onError = (e: unknown) => setNotice({ tone: "error", text: errorMessage(e) });

  const setMembership = useMutation(trpc.memberships.set.mutationOptions({ onSuccess: invalidate, onError }));
  const removeMembership = useMutation(trpc.memberships.remove.mutationOptions({ onSuccess: invalidate, onError }));
  const updateUser = useMutation(trpc.users.update.mutationOptions({ onSuccess: invalidate, onError }));
  const deactivate = useMutation(trpc.users.deactivate.mutationOptions({ onSuccess: invalidate, onError }));
  const reactivate = useMutation(trpc.users.reactivate.mutationOptions({ onSuccess: invalidate, onError }));
  const resetPassword = useMutation(
    trpc.users.resetPassword.mutationOptions({
      onSuccess: (r, v) =>
        setNotice({
          tone: "ok",
          text: `Temporary password for ${users.data?.find((u) => u.id === v.id)?.email}. Share it securely; it's shown once.`,
          secret: r.temporaryPassword,
        }),
      onError,
    }),
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">People</h1>
        <p className="text-gray-400">
          {me.isSuperAdmin
            ? "You can add anyone, give admin or viewer access to any theater, and make super admins."
            : "You can add viewers to the theaters you administer."}
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-6 rounded-lg border p-4 text-sm ${
            notice.tone === "ok"
              ? "border-green-800 bg-green-950/40 text-green-200"
              : "border-red-800 bg-red-950/40 text-red-200"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss">
              ×
            </button>
          </div>
          {notice.secret && (
            <code className="mt-2 inline-block rounded bg-black/40 px-2 py-1 text-base text-white select-all">
              {notice.secret}
            </code>
          )}
        </div>
      )}

      {manageable.length > 0 && (
        <CreateUser
          theaters={manageable}
          onCreated={(email, password) => {
            setNotice({
              tone: "ok",
              text: `Created ${email}. Give them this temporary password; they'll set their own when they first sign in. It's shown once.`,
              secret: password,
            });
            void invalidate();
          }}
        />
      )}

      <div className={`${panelClass} p-4 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Users</h2>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">Theater</span>
            <select
              value={theaterFilter}
              onChange={(e) => setTheaterFilter(e.target.value)}
              className={`${inputClass} min-w-52`}
            >
              <option value="">{me.isSuperAdmin ? "Everyone" : "All my theaters"}</option>
              {(theaters.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {users.error && <p className="text-sm text-red-400">{errorMessage(users.error)}</p>}
        <ul className="divide-y divide-gray-800">
          {(users.data ?? []).map((u) => (
            <UserRow
              key={u.id}
              user={u}
              theaters={theaters.data ?? []}
              isSelf={u.id === me.id}
              onSetRole={(theaterId, role) => setMembership.mutate({ userId: u.id, theaterId, role })}
              onRemove={(theaterId) => removeMembership.mutate({ userId: u.id, theaterId })}
              onToggleSuper={() => updateUser.mutate({ id: u.id, isSuperAdmin: !u.isSuperAdmin })}
              onDeactivate={() => {
                if (confirm(`Deactivate ${u.name}? They'll be signed out everywhere.`)) deactivate.mutate({ id: u.id });
              }}
              onReactivate={() => reactivate.mutate({ id: u.id })}
              onResetPassword={() => {
                if (confirm(`Reset ${u.name}'s password? They'll be signed out.`)) resetPassword.mutate({ id: u.id });
              }}
            />
          ))}
          {users.data?.length === 0 && <li className="py-6 text-center text-gray-500">No users here.</li>}
        </ul>
      </div>
    </>
  );
}

function UserRow({
  user,
  theaters,
  isSelf,
  onSetRole,
  onRemove,
  onToggleSuper,
  onDeactivate,
  onReactivate,
  onResetPassword,
}: {
  user: UserView;
  theaters: Theater[];
  isSelf: boolean;
  onSetRole: (theaterId: string, role: TheaterRole) => void;
  onRemove: (theaterId: string) => void;
  onToggleSuper: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onResetPassword: () => void;
}) {
  const me = useMe();
  const [addTheater, setAddTheater] = useState("");
  const memberOf = new Set(user.memberships.map((m) => m.theaterId));
  const addable = theaters.filter((t) => !memberOf.has(t.id) && grantableRoles(me, t.id).length > 0);

  return (
    <li className={`py-4 ${user.status === "deactivated" ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium text-white">
            {user.name}
            {isSelf && <span className="ml-2 text-xs text-gray-500">(you)</span>}
            {user.isSuperAdmin && (
              <span className="ml-2 rounded-full bg-purple-900 px-2 py-0.5 text-xs text-purple-200">super admin</span>
            )}
            {user.status === "deactivated" && (
              <span className="ml-2 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">deactivated</span>
            )}
          </div>
          <div className="text-sm text-gray-400">{user.email}</div>
        </div>
        {me.isSuperAdmin && !isSelf && (
          <div className="flex flex-wrap gap-2">
            <button className={secondaryButton} onClick={onToggleSuper}>
              {user.isSuperAdmin ? "Remove super admin" : "Make super admin"}
            </button>
            <button className={secondaryButton} onClick={onResetPassword}>
              Reset password
            </button>
            {user.status === "active" ? (
              <button className={secondaryButton} onClick={onDeactivate}>
                Deactivate
              </button>
            ) : (
              <button className={secondaryButton} onClick={onReactivate}>
                Reactivate
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {user.isSuperAdmin && <span className="text-xs text-gray-500">Admin of every theater.</span>}
        {user.memberships.map((m) => {
          const roles = grantableRoles(me, m.theaterId);
          // Theater admins can't touch another admin's access.
          const editable = !isSelf && (me.isSuperAdmin || (m.role === "viewer" && roles.includes("viewer")));
          return (
            <span
              key={m.theaterId}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800/60 px-2 py-1 text-xs"
            >
              <span className="text-gray-200">{m.theaterName}</span>
              {editable && me.isSuperAdmin ? (
                <select
                  aria-label={`${user.name}'s role at ${m.theaterName}`}
                  value={m.role}
                  onChange={(e) => onSetRole(m.theaterId, e.target.value as TheaterRole)}
                  className={smallSelectClass}
                >
                  <option value="admin">admin</option>
                  <option value="viewer">viewer</option>
                </select>
              ) : (
                <span className={m.role === "admin" ? "text-purple-300" : "text-gray-400"}>{m.role}</span>
              )}
              {editable && (
                <button
                  onClick={() => onRemove(m.theaterId)}
                  className="ml-1 text-gray-500 hover:text-red-400"
                  aria-label={`Remove ${user.name} from ${m.theaterName}`}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {!user.isSuperAdmin && user.memberships.length === 0 && (
          <span className="text-xs text-gray-500">No theaters.</span>
        )}
        {!isSelf && addable.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <select
              aria-label={`Add ${user.name} to a theater`}
              value={addTheater}
              onChange={(e) => setAddTheater(e.target.value)}
              className={smallSelectClass}
            >
              <option value="">+ Add to theater…</option>
              {addable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {addTheater &&
              grantableRoles(me, addTheater).map((r) => (
                <button
                  key={r}
                  className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                  onClick={() => {
                    onSetRole(addTheater, r);
                    setAddTheater("");
                  }}
                >
                  as {r}
                </button>
              ))}
          </span>
        )}
      </div>
    </li>
  );
}

function CreateUser({
  theaters,
  onCreated,
}: {
  theaters: Theater[];
  onCreated: (email: string, password: string) => void;
}) {
  const trpc = useTRPC();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSuperAdmin, setSuper] = useState(false);
  const [roles, setRoles] = useState<Record<string, TheaterRole | "">>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation(
    trpc.users.create.mutationOptions({
      onSuccess: (r) => {
        onCreated(r.user.email, r.temporaryPassword);
        setName("");
        setEmail("");
        setSuper(false);
        setRoles({});
        setOpen(false);
      },
    }),
  );

  if (!open) {
    return (
      <div className="mb-6">
        <button className={primaryButton} onClick={() => setOpen(true)}>
          Add a person
        </button>
      </div>
    );
  }

  return (
    <form
      className={`${panelClass} mb-6 space-y-4 p-4 sm:p-6`}
      onSubmit={(e) => {
        e.preventDefault();
        const memberships = Object.entries(roles)
          .filter((entry): entry is [string, TheaterRole] => entry[1] !== "")
          .map(([theaterId, role]) => ({ theaterId, role }));
        // Same schema the API validates with.
        const parsed = UserCreateInput.safeParse({ name, email, isSuperAdmin, memberships });
        if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? "Check the form");
        if (!me.isSuperAdmin && memberships.length === 0) return setFormError("Pick at least one theater");
        setFormError(null);
        create.mutate(parsed.data);
      }}
    >
      <h2 className="text-lg font-semibold text-white">Add a person</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={inputClass} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className={inputClass}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {me.isSuperAdmin && (
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={isSuperAdmin} onChange={(e) => setSuper(e.target.checked)} />
          Super admin (admin of every theater, can manage people)
        </label>
      )}
      {!isSuperAdmin && (
        <div>
          <p className="mb-2 text-xs text-gray-400">Theater access</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {theaters.map((t) => (
              <label
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm"
              >
                <span className="text-gray-200">{t.name}</span>
                <select
                  value={roles[t.id] ?? ""}
                  onChange={(e) => setRoles({ ...roles, [t.id]: e.target.value as TheaterRole | "" })}
                  className={smallSelectClass}
                >
                  <option value="">No access</option>
                  {grantableRoles(me, t.id).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      {(formError ?? create.error) && <p className="text-sm text-red-400">{formError ?? errorMessage(create.error)}</p>}
      <div className="flex gap-3">
        <button className={primaryButton} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
