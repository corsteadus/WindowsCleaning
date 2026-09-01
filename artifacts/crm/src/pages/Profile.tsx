import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, User, Mail, Shield, Save, CheckCircle, Camera,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { protectedFetch } from "@/lib/auth-scope";
import { roleLabel } from "@/lib/rbac";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();

  const [firstName, setFirstName] = useState((user as any)?.firstName ?? "");
  const [lastName,  setLastName]  = useState((user as any)?.lastName  ?? "");
  const [saved,     setSaved]     = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName,
          lastName,
        }),
      }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["me"] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  const displayName =
    firstName || lastName
      ? `${firstName} ${lastName}`.trim()
      : (user as any)?.email || "User";

  const initials = (firstName?.[0] || (user as any)?.email?.[0] || "U").toUpperCase();

  return (
    <div className="max-w-lg mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 rounded-xl">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">My Profile</h1>
            <p className="text-xs text-slate-400">Update your name and account settings</p>
          </div>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white
                     text-sm font-semibold text-slate-600 hover:text-slate-900 hover:border-slate-300
                     hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
      </div>

      {/* Avatar card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4">
        <div className="relative shrink-0">
          {(user as any)?.profileImageUrl ? (
            <img
              src={(user as any).profileImageUrl}
              alt="Profile"
              className="w-16 h-16 rounded-full object-cover ring-4 ring-white shadow-md"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-white shadow-md">
              <span className="text-primary font-bold text-xl">{initials}</span>
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 bg-slate-100 border-2 border-white rounded-full p-1">
            <Camera className="w-3 h-3 text-slate-400" />
          </div>
        </div>
        <div>
          <p className="font-bold text-slate-900">{displayName}</p>
          <p className="text-sm text-slate-500">{(user as any)?.email}</p>
          <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full
            ${(user as any)?.role === "super_admin" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
            {roleLabel((user as any)?.role)}
          </span>
          <p className="text-[11px] text-slate-400 mt-1">
            Profile photo synced from your Replit account
          </p>
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-800">Personal Information</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-900
                         placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20
                         focus:border-primary/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-900
                         placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20
                         focus:border-primary/50 transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            <Mail className="w-3 h-3 inline mr-1" />
            Email Address
          </label>
          <input
            type="email"
            value={(user as any)?.email ?? ""}
            disabled
            className="w-full h-10 px-3 rounded-xl border border-slate-100 bg-slate-50 text-sm
                       text-slate-400 cursor-not-allowed"
          />
          <p className="text-[11px] text-slate-400 mt-1">Email is managed by your Replit account and cannot be changed here.</p>
        </div>
      </div>

      {/* Role section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800">Account Role</h2>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{roleLabel((user as any)?.role)}</p>
            <p className="text-xs text-slate-400">Roles are managed from Team Users.</p>
          </div>
        </div>
      </div>

      {/* Save button */}
      {saveMutation.isError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
          {String(saveMutation.error)}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-white text-sm
                     font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saveMutation.isPending ? (
            <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</>
          ) : saved ? (
            <><CheckCircle className="w-4 h-4" />Saved!</>
          ) : (
            <><Save className="w-4 h-4" />Save Changes</>
          )}
        </button>

        <button
          onClick={logout}
          className="h-10 px-4 rounded-xl border border-slate-200 text-sm font-semibold
                     text-slate-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
