/**
 * Whether customers are told when their work is scheduled or moved.
 *
 * Kyle, 2026-09-24 #4: *"This feature must be optional. The business should be
 * able to turn scheduling notifications on or off in Settings."* Both start off,
 * and turning one on still only means the office will be **asked** — nothing
 * leaves without somebody answering the prompt.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Settings {
  scheduleEmailEnabled: boolean;
  scheduleSmsEnabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  smsDeliverable: boolean;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string })?.error ?? "Request failed");
  return body as T;
}

export function ScheduleNotificationSettings({
  canManage, capabilitiesLoading,
}: { canManage: boolean; capabilitiesLoading: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState(false);
  const [sms, setSms] = useState(false);

  const query = useQuery<Settings>({
    queryKey: ["communication-notification-settings"],
    queryFn: () => api<Settings>("/communication-safety/notification-settings"),
    enabled: canManage,
  });

  useEffect(() => {
    if (!query.data) return;
    setEmail(query.data.scheduleEmailEnabled);
    setSms(query.data.scheduleSmsEnabled);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api<Settings>("/communication-safety/notification-settings", {
      method: "PUT",
      body: JSON.stringify({ scheduleEmailEnabled: email, scheduleSmsEnabled: sms }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["communication-notification-settings"] });
      toast({
        title: "Scheduling notifications saved",
        description: email || sms
          ? "You will be asked, each time a job is scheduled or moved, whether to tell the customer."
          : "Customers will not be told about scheduling, and you will not be asked.",
      });
    },
    onError: (error) => toast({
      title: "Could not save", variant: "destructive",
      description: error instanceof Error ? error.message : undefined,
    }),
  });

  if (capabilitiesLoading) return null;
  if (!canManage) return null;

  const dirty = Boolean(query.data)
    && (email !== query.data!.scheduleEmailEnabled || sms !== query.data!.scheduleSmsEnabled);

  return (
    <section className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-5 py-3 flex items-center gap-2 border-b border-slate-200">
        <BellRing className="w-4 h-4 text-slate-500" />
        <h2 className="font-bold text-slate-900">Scheduling notifications</h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-slate-600">
          When this is on, Corstead asks you — each time a job is first booked or its date or
          time changes — whether the customer should be told. Nothing is ever sent without
          that answer, and changing only the crew never asks.
        </p>

        <label className="flex items-start gap-3">
          <input
            type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600"
            aria-label="Ask about emailing the customer"
            checked={email} onChange={(event) => setEmail(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-slate-800">Email</span>
            <span className="block text-xs text-slate-500">Offer to email the customer about a schedule.</span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600"
            aria-label="Ask about texting the customer"
            checked={sms} onChange={(event) => setSms(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-slate-800">Text message</span>
            <span className="block text-xs text-slate-500">Offer to text the customer about a schedule.</span>
          </span>
        </label>

        {sms && query.data && !query.data.smsDeliverable && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Corstead has no text-message provider connected yet, so a text will be recorded but
            will not reach the customer. Email is the working channel today.
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {query.data?.updatedAt && (
            <span className="text-xs text-slate-400">
              Last changed by {query.data.updatedBy ?? "someone"} on {query.data.updatedAt.slice(0, 10)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
