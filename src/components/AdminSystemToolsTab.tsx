/**
 * ADMIN — SYSTEM TOOLS.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * These four actions used to hang off the trainer's Hub Settings. Deleting
 * that screen would have deleted their only trigger, so they land here rather
 * than disappearing — which matters most for the demo seeder: the studios are
 * migrating off Claris FileMaker and the cutover needs a demo mode, so quietly
 * losing the one button that creates demo data would have been the expensive
 * kind of tidy-up.
 *
 * Ordered least to most destructive, and the wipe is separated by a divider
 * and painted as a hazard. Three of these are recoverable; one is not.
 */

import React, { useState } from "react";
import {
  Calculator,
  Database,
  ListOrdered,
  RotateCcw,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import { functions } from "../firebase";
import { useToast } from "../contexts/ToastContext";

export interface AdminSystemToolsTabProps {
  onSeedDemoClient?: () => void;
  onRestoreMachines?: () => void;
  onReorderTrainers?: () => void;
  onAppCleanse?: () => void;
}

function ToolRow({
  icon: Icon,
  title,
  detail,
  action,
  onClick,
  danger,
}: {
  icon: typeof Database;
  title: string;
  detail: string;
  action: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 sm:px-8 py-5">
      <div
        className={[
          "w-10 h-10 rounded-xl flex items-center justify-center border shrink-0",
          danger ? "bg-red-500/10 border-red-500/30" : "bg-muted border-border",
        ].join(" ")}
      >
        <Icon className={danger ? "w-5 h-5 text-red-500" : "w-5 h-5 text-cta"} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black uppercase tracking-widest text-foreground">
          {title}
        </p>
        <p className="text-sm text-muted-foreground font-medium leading-relaxed">
          {detail}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onClick}
        disabled={!onClick}
        className={[
          "h-11 px-5 rounded-2xl font-black uppercase text-[10px] tracking-widest shrink-0",
          danger
            ? "border-red-500/40 text-red-500 hover:bg-red-500/10"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
        ].join(" ")}
      >
        {action}
      </Button>
    </div>
  );
}

export function AdminSystemToolsTab({
  onSeedDemoClient,
  onRestoreMachines,
  onReorderTrainers,
  onAppCleanse,
}: AdminSystemToolsTabProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [rebuilding, setRebuilding] = useState(false);

  /**
   * Counts every completed session once and writes each trainer's totals.
   *
   * Needed because the write-time counter only sees sessions completed after
   * it was deployed; everything before that -- including the Claris FileMaker
   * import -- has to be counted in one pass. Authoritative and idempotent: it
   * SETS each total from a full scan rather than adding, so running it twice
   * gives the same answer.
   *
   * Reads every session document once, so it is a button rather than
   * something that happens on app load, and it belongs outside studio hours:
   * a session completed mid-scan can be counted by both the scan and the
   * trigger, which a re-run then corrects.
   */
  const handleRebuildRollups = async () => {
    setRebuilding(true);
    try {
      const call = httpsCallable(functions, "backfillTrainerRollups");
      const result: any = await call({});
      const data = result?.data || {};
      toastSuccess(
        `Counted ${data.sessionsCounted ?? 0} sessions across ${data.trainers ?? 0} trainers` +
          (data.sessionsUnresolved
            ? ` · ${data.sessionsUnresolved} could not be credited to anyone`
            : ""),
      );
    } catch (err: any) {
      toastError(err?.message || "Couldn't rebuild trainer rollups.");
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className="rounded-[32px] border border-border bg-card overflow-hidden">
      <header className="flex items-center gap-4 px-6 sm:px-8 py-6 border-b border-border bg-background">
        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center border border-border shadow-inner shrink-0">
          <Database className="w-6 h-6 text-cta" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl sm:text-2xl font-black text-foreground italic tracking-tight">
            System Tools
          </h3>
          <p className="text-muted-foreground font-medium uppercase text-[10px] sm:text-[11px] tracking-widest">
            Seed, restore and reset
          </p>
        </div>
      </header>

      <div className="divide-y divide-border">
        <ToolRow
          icon={UserPlus}
          title="Seed a demo client"
          detail="Creates a demo client with sessions and logs, for training staff and for walking through the app without touching a real record."
          action="Create"
          onClick={onSeedDemoClient}
        />
        <ToolRow
          icon={ListOrdered}
          title="Reorder trainers"
          detail="Sets the order trainers appear in across the roster, calendars and pickers."
          action="Reorder"
          onClick={onReorderTrainers}
        />
        <ToolRow
          icon={Calculator}
          title="Rebuild trainer rollups"
          detail="Counts every completed session and writes each trainer's totals. Run once after deploying, then only if the numbers ever look wrong — it reads every session, so keep it outside studio hours."
          action={rebuilding ? "Counting…" : "Rebuild"}
          onClick={rebuilding ? undefined : handleRebuildRollups}
        />
        <ToolRow
          icon={RotateCcw}
          title="Restore standard machines"
          detail="Re-writes the 20 standard machine definitions to factory defaults. Merges rather than replaces, so studio-specific settings survive."
          action="Restore"
          onClick={onRestoreMachines}
        />
      </div>

      <div className="border-t-2 border-red-500/20 bg-red-500/[0.03]">
        <p className="flex items-start gap-2.5 px-6 sm:px-8 pt-5 text-sm text-red-500 font-medium leading-relaxed">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            The action below cannot be undone and is not limited to one studio.
          </span>
        </p>
        <ToolRow
          icon={TriangleAlert}
          title="Wipe and re-initialize"
          detail="Permanently deletes every client, trainer, session, schedule, note and log, then re-creates the standard machines."
          action="Wipe"
          onClick={onAppCleanse}
          danger
        />
      </div>
    </section>
  );
}
