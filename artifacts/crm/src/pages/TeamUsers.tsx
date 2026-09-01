import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserCheck, UserMinus, UserPlus, ShieldCheck } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { protectedFetch } from "@/lib/auth-scope";
import { hasClientCapability, roleLabel } from "@/lib/rbac";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "office_admin", label: "Office Admin" },
  { value: "sales", label: "Sales" },
  { value: "field_tech", label: "Field Tech" },
  { value: "super_admin", label: "Super Admin" },
];

interface TeamUser {
  id: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
  hasLocalPassword: boolean;
  createdAt: string;
}

async function apiFetch(path: string, options?: RequestInit) {
  const response = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Request failed");
  return response.json();
}

function UserForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({ username: "", password: "", firstName: "", lastName: "", email: "", role: "office_admin" });
  const mutation = useMutation({
    mutationFn: () => apiFetch("/api/admin/users", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-users"] }); onDone(); },
  });
  const canCreateSuperAdmin = hasClientCapability(user, "admin.settings");
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }} className="grid gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 md:grid-cols-3">
      {(["firstName", "lastName", "username", "email", "password"] as const).map((field) => (
        <input
          key={field}
          type={field === "password" ? "password" : "text"}
          required={field === "username" || field === "password"}
          value={form[field]}
          onChange={(event) => setForm({ ...form, [field]: event.target.value })}
          placeholder={field === "firstName" ? "First name" : field === "lastName" ? "Last name" : field === "email" ? "Email (optional)" : field === "username" ? "Username" : "Temporary password"}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary"
        />
      ))}
      <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">
        {ROLES.filter((role) => role.value !== "super_admin" || canCreateSuperAdmin).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
      </select>
      <div className="md:col-span-3 flex items-center gap-3">
        <button disabled={mutation.isPending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />{mutation.isPending ? "Creating…" : "Create User"}</button>
        {mutation.isError && <p className="text-sm text-red-600">{String(mutation.error)}</p>}
      </div>
    </form>
  );
}

export default function TeamUsers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const { data: users = [], isLoading } = useQuery<TeamUser[]>({ queryKey: ["team-users"], queryFn: () => apiFetch("/api/admin/users") });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiFetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-users"] }),
  });
  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => apiFetch(`/api/admin/users/${id}/password-reset`, { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: () => { setResetId(null); setNewPassword(""); },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold text-slate-900">Team Users</h1></div>
          <p className="mt-1 text-sm text-slate-500">Manage local employee accounts and role-based access. Passwords are never displayed after submission.</p>
        </div>
        <button onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white"><UserPlus className="h-4 w-4" />Add User</button>
      </div>
      {showForm && <UserForm onDone={() => setShowForm(false)} />}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {isLoading ? <p className="p-6 text-sm text-slate-400">Loading users…</p> : (
          <div className="divide-y divide-slate-100">
            {users.map((teamUser) => {
              const isSelf = teamUser.id === user?.id;
              const display = [teamUser.firstName, teamUser.lastName].filter(Boolean).join(" ") || teamUser.email || teamUser.username || "Unnamed user";
              return (
                <div key={teamUser.id} className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-[220px] flex-1"><p className="font-semibold text-slate-800">{display}</p><p className="text-xs text-slate-400">{teamUser.username ? `@${teamUser.username}` : "Replit account"}{teamUser.email ? ` · ${teamUser.email}` : ""}</p></div>
                  <select disabled={teamUser.role === "super_admin" || isSelf} value={teamUser.role} onChange={(event) => updateMutation.mutate({ id: teamUser.id, body: { role: event.target.value } })} className="h-9 rounded-lg border border-slate-200 px-2 text-xs">
                    {ROLES.filter((role) => role.value !== "super_admin" || teamUser.role === "super_admin").map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${teamUser.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{teamUser.isActive ? "Active" : "Inactive"}</span>
                  <div className="flex items-center gap-2">
                    <button disabled={isSelf || teamUser.role === "super_admin"} onClick={() => updateMutation.mutate({ id: teamUser.id, body: { isActive: !teamUser.isActive } })} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{teamUser.isActive ? <UserMinus className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}{teamUser.isActive ? "Deactivate" : "Activate"}</button>
                    <button onClick={() => { setResetId(teamUser.id); setNewPassword(""); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><KeyRound className="h-3.5 w-3.5" />Reset password</button>
                  </div>
                  {resetId === teamUser.id && <div className="flex w-full items-center gap-2 rounded-xl bg-slate-50 p-3"><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New temporary password" className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm" /><button disabled={!newPassword || resetMutation.isPending} onClick={() => resetMutation.mutate({ id: teamUser.id, password: newPassword })} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Save password</button></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}