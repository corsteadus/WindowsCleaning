/**
 * The profile this one sits beneath, and the profiles that sit beneath it.
 *
 * Kyle (2026-09-23, answer #5): *"Linking only. Any profile can sit beneath a
 * main profile, residential or commercial, one or many. No 'bill to parent', no
 * combined invoices — linking changes nothing about billing."*
 *
 * So this card links and says so, and deliberately shows **no totals**: an
 * invoice stays on the profile it belongs to, and putting a number here would
 * be the first step towards the combined billing he ruled out.
 *
 * Two levels: a main profile has profiles beneath it, and those have none of
 * their own — so a profile that already has any is not offered a main profile.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2, Link2, Loader2, User, X } from "lucide-react";
import { Link } from "wouter";
import { CustomerCombobox } from "@/components/CustomerCombobox";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface ProfileLink {
  id: number;
  name: string;
  lifecycleStatus?: string | null;
  accountType?: string | null;
}

interface PickableProfile {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  clientType?: string | null;
}

const profileLabel = (profile: PickableProfile) =>
  (profile.companyName ?? "").trim()
  || [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim()
  || `Profile #${profile.id}`;

function ProfileRow({ profile }: { profile: ProfileLink }) {
  const Icon = profile.accountType === "commercial" ? Building2 : User;
  return (
    <Link
      href={`/customers/${profile.id}`}
      className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm
                 text-slate-700 hover:border-slate-200 hover:bg-slate-50 transition-colors"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="truncate font-medium">{profile.name}</span>
      {profile.lifecycleStatus && (
        <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-500">
          {profile.lifecycleStatus}
        </span>
      )}
    </Link>
  );
}

export function MainProfileCard({
  customerId, mainProfile, subProfiles, canManage, onChanged,
}: {
  customerId: number;
  mainProfile: ProfileLink | null;
  subProfiles: ProfileLink[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<PickableProfile | null>(null);

  const save = useMutation({
    mutationFn: async (parentCustomerId: number | null) => {
      const response = await protectedFetch(`${BASE}/api/customers/${customerId}/main-profile`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCustomerId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { error?: string })?.error ?? "Could not change the main profile");
      return body as { mainProfileChange?: string };
    },
    onSuccess: (body) => {
      setPicked(null);
      onChanged();
      toast({ title: "Main profile updated", description: body.mainProfileChange });
    },
    onError: (error) => toast({
      title: "Could not change the main profile",
      description: error instanceof Error ? error.message : undefined,
      variant: "destructive",
    }),
  });

  const isMainProfile = subProfiles.length > 0;

  return (
    <div className="space-y-4">
      {/* ── the one above ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Main profile</p>
        {mainProfile ? (
          <div className="mt-2 space-y-2">
            <ProfileRow profile={mainProfile} />
            {canManage && (
              <button
                type="button"
                onClick={() => save.mutate(null)}
                disabled={save.isPending}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-red-600 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Take this profile out from under it
              </button>
            )}
          </div>
        ) : isMainProfile ? (
          <p className="mt-2 text-sm text-slate-500">
            This is a main profile — the profiles below sit beneath it. Corstead keeps this to one
            level, so it cannot also sit beneath another.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-slate-500">This profile does not sit beneath another.</p>
            {canManage && (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CustomerCombobox<PickableProfile>
                    selectedCustomer={picked}
                    onSelect={setPicked}
                    labelFor={profileLabel}
                    placeholder="Choose a main profile"
                    showClientTypeIcon
                    activeOnly={false}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => picked && save.mutate(picked.id)}
                  disabled={!picked || save.isPending}
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3
                             text-xs font-bold text-white disabled:opacity-40"
                >
                  {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Link
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── the ones beneath ────────────────────────────────────────────── */}
      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Profiles beneath this one
          {subProfiles.length > 0 && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              {subProfiles.length}
            </span>
          )}
        </p>
        {subProfiles.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">None yet.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {subProfiles.map((profile) => <ProfileRow key={profile.id} profile={profile} />)}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Linking profiles does not change billing: every invoice stays on the profile it belongs to.
        </p>
      </div>
    </div>
  );
}
