"use client";

import { can, type TheaterRole, UserCreateInput, type UserView } from "@scope/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { button, column, field, h1, inlineSelect, selectField } from "~/lib/ui";
import { principalOf, type TheaterOption, useShell } from "../../_components/AppShell";

type Me = ReturnType<typeof useShell>["me"];

/** Roles the caller may grant in a theater: super admins any, theater admins viewer only. */
function grantableRoles(me: Me, theaterId: string): TheaterRole[] {
  if (me.isSuperAdmin) return ["admin", "viewer"];
  return can(principalOf(me), "member.manageViewers", theaterId) ? ["viewer"] : [];
}

const roleWord: Record<TheaterRole, string> = { admin: "Admin", viewer: "Viewer" };

export default function PeoplePage() {
  const trpc = useTRPC();
  const { me, theaters, notify } = useShell();
  const queryClient = useQueryClient();
  const [theaterFilter, setTheaterFilter] = useState("");
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const users = useQuery(trpc.users.list.queryOptions({ theaterId: theaterFilter || undefined }));
  const manageable = theaters.filter((t) => grantableRoles(me, t.id).length > 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.users.pathKey() });
  const onError = (e: unknown) => notify(errorMessage(e), "error");
  const done = (text: string) => () => {
    notify(text);
    void invalidate();
  };

  const setMembership = useMutation(
    trpc.memberships.set.mutationOptions({ onSuccess: done("Access updated."), onError }),
  );
  const removeMembership = useMutation(
    trpc.memberships.remove.mutationOptions({ onSuccess: done("Removed from theater."), onError }),
  );
  const updateUser = useMutation(
    trpc.users.update.mutationOptions({ onSuccess: done("Super admin updated."), onError }),
  );
  const deactivate = useMutation(
    trpc.users.deactivate.mutationOptions({ onSuccess: done("User deactivated and signed out."), onError }),
  );
  const reactivate = useMutation(
    trpc.users.reactivate.mutationOptions({ onSuccess: done("User reactivated."), onError }),
  );
  const resetPassword = useMutation(
    trpc.users.resetPassword.mutationOptions({
      onSuccess: (r, v) =>
        setSecret({ who: users.data?.find((u) => u.id === v.id)?.email ?? "this user", password: r.temporaryPassword }),
      onError,
    }),
  );

  return (
    <div className={`${column} pt-8 pb-24`}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className={h1}>People</h1>
          <p className="mt-2 text-[15px] text-pretty text-ink-2">
            {me.isSuperAdmin
              ? "Give anyone admin or viewer access to any theater, or make them a super admin."
              : "Add and remove viewers in the theaters you administer."}
          </p>
        </div>
        {manageable.length > 0 && !adding && (
          <button className={button.primary} onClick={() => setAdding(true)}>
            Add person
          </button>
        )}
      </div>

      {secret && (
        <div role="status" className="mt-8 border-l-2 border-ink pl-4">
          <p className="text-[13px] text-ink-2">
            Temporary password for <span className="text-ink">{secret.who}</span>. It&apos;s shown once; they&apos;ll
            choose their own when they sign in.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <code className="tnum rounded-md bg-wash px-2.5 py-1.5 text-[14px] select-all">{secret.password}</code>
            <button className={button.link} onClick={() => void navigator.clipboard?.writeText(secret.password)}>
              Copy
            </button>
            <button className={button.link} onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {adding && (
        <CreateUser
          theaters={manageable}
          onCancel={() => setAdding(false)}
          onCreated={(email, password) => {
            setAdding(false);
            setSecret({ who: email, password });
            void invalidate();
          }}
        />
      )}

      <div className="mt-10 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold whitespace-nowrap">
          {users.data ? `${users.data.length} ${users.data.length === 1 ? "person" : "people"}` : "People"}
        </h2>
        <select
          aria-label="Filter by theater"
          value={theaterFilter}
          onChange={(e) => setTheaterFilter(e.target.value)}
          className={`${selectField} !w-48 shrink-0`}
        >
          <option value="">{me.isSuperAdmin ? "Everyone" : "All my theaters"}</option>
          {theaters.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {users.error && <p className="mt-4 text-[13px] text-remove">{errorMessage(users.error)}</p>}

      <ul className="mt-3 border-t border-line">
        {(users.data ?? []).map((u) => (
          <UserRow
            key={u.id}
            user={u}
            theaters={theaters}
            isSelf={u.id === me.id}
            onSetRole={(theaterId, role) => setMembership.mutate({ userId: u.id, theaterId, role })}
            onRemove={(theaterId) => removeMembership.mutate({ userId: u.id, theaterId })}
            onToggleSuper={() => updateUser.mutate({ id: u.id, isSuperAdmin: !u.isSuperAdmin })}
            onDeactivate={() =>
              confirm(`Deactivate ${u.name}? They'll be signed out everywhere.`) && deactivate.mutate({ id: u.id })
            }
            onReactivate={() => reactivate.mutate({ id: u.id })}
            onResetPassword={() =>
              confirm(`Give ${u.name} a new temporary password? They'll be signed out.`) &&
              resetPassword.mutate({ id: u.id })
            }
          />
        ))}
      </ul>
      {users.data?.length === 0 && <p className="py-10 text-center text-[13px] text-ink-2">Nobody here yet.</p>}
    </div>
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
  theaters: TheaterOption[];
  isSelf: boolean;
  onSetRole: (theaterId: string, role: TheaterRole) => void;
  onRemove: (theaterId: string) => void;
  onToggleSuper: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onResetPassword: () => void;
}) {
  const { me } = useShell();
  const memberOf = new Set(user.memberships.map((m) => m.theaterId));
  const addable = theaters.filter((t) => !memberOf.has(t.id) && grantableRoles(me, t.id).length > 0);
  const off = user.status === "deactivated";

  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className={off ? "text-ink-3" : ""}>
          <span className="font-medium">{user.name}</span>
          {isSelf && <span className="ml-2 text-[13px] text-ink-3">you</span>}
          <span className="ml-2 text-[13px] text-ink-2">{user.email}</span>
        </div>
        <span className="text-[13px] text-ink-2">
          {off
            ? "Deactivated"
            : user.isSuperAdmin
              ? "Super admin, every theater"
              : user.memberships.length === 0
                ? "No theaters"
                : null}
        </span>
      </div>

      {user.memberships.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {user.memberships.map((m) => {
            const roles = grantableRoles(me, m.theaterId);
            const editable = !isSelf && (me.isSuperAdmin || (m.role === "viewer" && roles.includes("viewer")));
            return (
              <li key={m.theaterId} className="flex items-center gap-2 text-[13px]">
                <span className="w-44 truncate text-ink-2 sm:w-52">{m.theaterName}</span>
                {editable && me.isSuperAdmin ? (
                  <select
                    aria-label={`${user.name}'s role at ${m.theaterName}`}
                    value={m.role}
                    onChange={(e) => onSetRole(m.theaterId, e.target.value as TheaterRole)}
                    className={inlineSelect}
                  >
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span>{roleWord[m.role]}</span>
                )}
                {editable && (
                  <button
                    onClick={() => onRemove(m.theaterId)}
                    aria-label={`Remove ${user.name} from ${m.theaterName}`}
                    className="rounded p-1 text-ink-3 hover:bg-wash hover:text-remove"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!isSelf && (addable.length > 0 || me.isSuperAdmin) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {me.isSuperAdmin && (
            <>
              <button className={button.link} onClick={onToggleSuper}>
                {user.isSuperAdmin ? "Remove super admin" : "Make super admin"}
              </button>
              <button className={button.link} onClick={onResetPassword}>
                Reset password
              </button>
              <button className={button.link} onClick={off ? onReactivate : onDeactivate}>
                {off ? "Reactivate" : "Deactivate"}
              </button>
            </>
          )}
          {addable.length > 0 && <AddToTheater theaters={addable} me={me} onAdd={onSetRole} name={user.name} />}
        </div>
      )}
    </li>
  );
}

function AddToTheater({
  theaters,
  me,
  onAdd,
  name,
}: {
  theaters: TheaterOption[];
  me: Me;
  onAdd: (t: string, r: TheaterRole) => void;
  name: string;
}) {
  const [theater, setTheater] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label={`Add ${name} to a theater`}
        value={theater}
        onChange={(e) => setTheater(e.target.value)}
        className={`${inlineSelect} text-ink-2`}
      >
        <option value="">Add to theater</option>
        {theaters.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {theater &&
        grantableRoles(me, theater).map((r) => (
          <button
            key={r}
            className={button.link}
            onClick={() => {
              onAdd(theater, r);
              setTheater("");
            }}
          >
            as {r}
          </button>
        ))}
    </span>
  );
}

function CreateUser({
  theaters,
  onCreated,
  onCancel,
}: {
  theaters: TheaterOption[];
  onCreated: (email: string, password: string) => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const { me } = useShell();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSuperAdmin, setSuper] = useState(false);
  const [roles, setRoles] = useState<Record<string, TheaterRole | "">>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation(
    trpc.users.create.mutationOptions({ onSuccess: (r) => onCreated(r.user.email, r.temporaryPassword) }),
  );

  return (
    <form
      className="mt-8 border-t border-line pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        const memberships = Object.entries(roles)
          .filter((entry): entry is [string, TheaterRole] => entry[1] !== "")
          .map(([theaterId, role]) => ({ theaterId, role }));
        const parsed = UserCreateInput.safeParse({ name, email, isSuperAdmin, memberships });
        if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? "Check the form");
        if (!me.isSuperAdmin && memberships.length === 0) return setFormError("Choose at least one theater.");
        setFormError(null);
        create.mutate(parsed.data);
      }}
    >
      <h2 className="text-[15px] font-semibold">Add a person</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          className={field}
          aria-label="Full name"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={field}
          aria-label="Email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {me.isSuperAdmin && (
        <label className="mt-4 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isSuperAdmin} onChange={(e) => setSuper(e.target.checked)} />
          Super admin: admin of every theater, can manage people
        </label>
      )}
      {!isSuperAdmin && (
        <div className="mt-4">
          <p className="text-[13px] text-ink-2">Theater access</p>
          <ul className="mt-1.5">
            {theaters.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1 text-[13px]">
                <span className="w-52 truncate">{t.name}</span>
                <select
                  aria-label={`Access at ${t.name}`}
                  value={roles[t.id] ?? ""}
                  onChange={(e) => setRoles({ ...roles, [t.id]: e.target.value as TheaterRole | "" })}
                  className={inlineSelect}
                >
                  <option value="">No access</option>
                  {grantableRoles(me, t.id).map((r) => (
                    <option key={r} value={r}>
                      {roleWord[r]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(formError ?? create.error) && (
        <p className="mt-3 text-[13px] text-remove">{formError ?? errorMessage(create.error)}</p>
      )}
      <div className="mt-5 flex items-center gap-4">
        <button className={button.primary} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create and get password"}
        </button>
        <button type="button" className={button.link} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
