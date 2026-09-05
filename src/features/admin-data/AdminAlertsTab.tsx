/**
 * ADMIN — ALERTS & COMMS.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * The trainer hub let anyone on the floor switch on automated SMS and email to
 * clients (E). That is exactly the control that should not sit next to a
 * theme picker: an accidental tap sends real messages to real clients, from a
 * studio, with nobody watching. It is admin work now.
 *
 * IT ALSO TELLS THE TRUTH ABOUT WHETHER ANYTHING SENDS
 * ----------------------------------------------------
 * These toggles write studios/{id}.notificationSettings, which the daily
 * reminder and coach report cron jobs read. Those cron jobs are commented out
 * of render.yaml (Sep 4) because no SMS or email provider has been chosen, so
 * right now flipping a switch here changes a flag and sends nothing.
 *
 * A toggle that appears to arm outbound messaging while silently doing nothing
 * is worse than no toggle: someone eventually relies on it. So the banner
 * states the delivery status plainly rather than letting the switch imply it.
 */

import React from "react";
import { Bell, Mail, PauseCircle, Settings } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { Switch } from "@/components/ui/switch";
import { useToast } from "../../contexts/ToastContext";
import { Studio } from "../../types";

export interface AdminAlertsTabProps {
  studios: Studio[];
  activeStudioId: string | null;
}

type NotificationKey = "bookingRemindersEnabled" | "dailySummaryEnabled";

const ROWS: {
  key: NotificationKey;
  icon: typeof Mail;
  title: string;
  detail: string;
}[] = [
  {
    key: "bookingRemindersEnabled",
    icon: Mail,
    title: "Client booking reminders",
    detail:
      "Sends an SMS or email to a client 24 hours before their session.",
  },
  {
    key: "dailySummaryEnabled",
    icon: Settings,
    title: "Owner daily action summary",
    detail:
      "Sends a daily digest of completed sessions to the studio owner's email.",
  },
];

export function AdminAlertsTab({ studios, activeStudioId }: AdminAlertsTabProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const activeStudio = studios.find((s) => s.id === activeStudioId);

  const toggle = async (key: NotificationKey, val: boolean) => {
    if (!activeStudioId) {
      toastError("Pick a studio first.");
      return;
    }
    try {
      await updateDoc(doc(db, "studios", activeStudioId), {
        [`notificationSettings.${key}`]: val,
      });
      toastSuccess("Notification settings updated.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toastError("Failed to update notification settings: " + message);
    }
  };

  return (
    <section className="rounded-[32px] border border-border bg-card overflow-hidden">
      <header className="flex items-center gap-4 px-6 sm:px-8 py-6 border-b border-border bg-background">
        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center border border-border shadow-inner shrink-0">
          <Bell className="w-6 h-6 text-cta" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl sm:text-2xl font-black text-foreground italic tracking-tight">
            Notifications &amp; Alerts
          </h3>
          <p className="text-muted-foreground font-medium uppercase text-[10px] sm:text-[11px] tracking-widest">
            Automated SMS / email reminders — {activeStudio?.name ?? "no studio selected"}
          </p>
        </div>
      </header>

      {/* Stated, not implied. See the file header. */}
      <p className="flex items-start gap-2.5 px-6 sm:px-8 py-4 bg-amber/5 border-b border-amber/20 text-sm text-amber font-medium leading-relaxed">
        <PauseCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>Outbound delivery is switched off system-wide.</strong> No SMS
          or email provider is connected and the reminder jobs are not deployed,
          so these settings are saved but nothing is sent yet.
        </span>
      </p>

      <div className="divide-y divide-border">
        {ROWS.map(({ key, icon: Icon, title, detail }) => (
          <div key={key} className="flex items-center gap-4 px-6 sm:px-8 py-5">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center border border-border shrink-0">
              <Icon className="w-5 h-5 text-cta" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black uppercase tracking-widest text-foreground">
                {title}
              </p>
              <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                {detail}
              </p>
            </div>
            <Switch
              checked={Boolean(activeStudio?.notificationSettings?.[key])}
              onCheckedChange={(val: boolean) => toggle(key, val)}
              disabled={!activeStudioId}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
