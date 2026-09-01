import { Link } from "wouter";
import { LockKeyhole, ArrowLeft } from "lucide-react";
import { roleLabel } from "@/lib/rbac";

export default function AccessDenied({ role }: { role: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Access Denied</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Your {roleLabel(role)} role does not have access to this area.
          Contact an owner or administrator if you need access.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}