/**
 * ADMIN — DATA & REPORTS.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * The new home for what used to be the trainer hub's "Data & Reports" tab (D)
 * and the legacy CSV ingestion that sat inside App Settings (B4). Both are
 * admin work: a payroll CSV covers every trainer at the studio, a progress CSV
 * carries client data in bulk, and the legacy importer writes thousands of
 * documents from one file picker while the client schema migration is still
 * pending.
 *
 * The two are on one screen because they are the same job in both directions -
 * data out, data in - and an admin looking for one is looking near the other.
 * The importer is placed second and visually cooled down deliberately: an
 * export is routine and a bulk import is not, and the destructive control
 * should not be the first thing under the thumb.
 */

import React, { useRef } from "react";
import { Database, Download, FileSpreadsheet, TrendingUp, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Client, Machine, Studio, Trainer } from "../../types";
import { useStudioExports } from "./useStudioExports";
import { useLegacyImport } from "./useLegacyImport";

export interface AdminDataReportsTabProps {
  trainers: Trainer[];
  clients: Client[];
  studios: Studio[];
  machines: Machine[];
  activeStudioId: string | null;
  authTrainer: Trainer | null;
}

function ExportCard({
  icon: Icon,
  title,
  description,
  onDownload,
  busy,
}: {
  icon: typeof Download;
  title: string;
  description: string;
  onDownload: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col rounded-3xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border bg-background">
        <Icon className="w-4 h-4 text-cta shrink-0" />
        <h4 className="text-[11px] font-black uppercase tracking-widest text-foreground">
          {title}
        </h4>
      </div>
      <div className="flex-1 px-5 py-4">
        <p className="text-sm text-muted-foreground font-medium leading-relaxed">
          {description}
        </p>
      </div>
      <div className="px-5 pb-5">
        <Button
          onClick={onDownload}
          disabled={busy}
          className="w-full h-11 rounded-2xl bg-cta text-white font-black uppercase text-[10px] tracking-widest gap-2 disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          {busy ? "Building…" : "Download CSV"}
        </Button>
      </div>
    </div>
  );
}

export function AdminDataReportsTab({
  trainers,
  clients,
  studios,
  machines,
  activeStudioId,
  authTrainer,
}: AdminDataReportsTabProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  const {
    exportStartDate,
    setExportStartDate,
    exportEndDate,
    setExportEndDate,
    isExportingPayroll,
    isExportingAttendance,
    isExportingProgress,
    handleExportPayroll,
    handleExportAttendance,
    handleExportProgress,
  } = useStudioExports({ trainers, clients, studios, activeStudioId });

  const { isLegacyImporting, legacyStats, legacyError, handleLegacyFileUpload } =
    useLegacyImport({ machines, activeStudioId, authTrainer });

  const studioName =
    studios.find((s) => s.id === activeStudioId)?.name ?? "all studios";

  return (
    <div className="space-y-6">
      {/* ── EXPORTS ──────────────────────────────────────────────── */}
      <section className="rounded-[32px] border border-border bg-card overflow-hidden">
        <header className="flex items-center gap-4 px-6 sm:px-8 py-6 border-b border-border bg-background">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center border border-border shadow-inner shrink-0">
            <Download className="w-6 h-6 text-cta" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-foreground italic tracking-tight">
              Data Exports &amp; Reporting
            </h3>
            <p className="text-muted-foreground font-medium uppercase text-[10px] sm:text-[11px] tracking-widest">
              CSV reports for performance, payroll and logs — {studioName}
            </p>
          </div>
        </header>

        <div className="p-6 sm:p-8 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-3xl border border-border bg-background">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Start date
              </Label>
              <Input
                type="date"
                value={exportStartDate}
                onChange={(e) => setExportStartDate(e.target.value)}
                className="h-11 rounded-2xl bg-card border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                End date
              </Label>
              <Input
                type="date"
                value={exportEndDate}
                onChange={(e) => setExportEndDate(e.target.value)}
                className="h-11 rounded-2xl bg-card border-border text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ExportCard
              icon={FileSpreadsheet}
              title="Trainer & payroll"
              description="Every completed session in the range with trainer, studio, client, date and type — the sheet payroll is actually built from."
              onDownload={handleExportPayroll}
              busy={isExportingPayroll}
            />
            <ExportCard
              icon={Users}
              title="Client attendance"
              description="Historical check-ins, completed sessions and no-shows, one row per session."
              onDownload={handleExportAttendance}
              busy={isExportingAttendance}
            />
            <ExportCard
              icon={TrendingUp}
              title="Client progress"
              description="Session counts, average resistance workload and target tracking, one row per client."
              onDownload={handleExportProgress}
              busy={isExportingProgress}
            />
          </div>
        </div>
      </section>

      {/* ── INGESTION ────────────────────────────────────────────── */}
      <section className="rounded-[32px] border border-amber/30 bg-card overflow-hidden">
        <header className="flex items-center gap-4 px-6 sm:px-8 py-6 border-b border-amber/20 bg-amber/5">
          <div className="w-12 h-12 rounded-2xl bg-amber/10 flex items-center justify-center border border-amber/30 shrink-0">
            <Database className="w-6 h-6 text-amber" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-foreground italic tracking-tight">
              Legacy Data Ingestion
            </h3>
            <p className="text-muted-foreground font-medium uppercase text-[10px] sm:text-[11px] tracking-widest">
              Import historical FileMaker client logs
            </p>
          </div>
        </header>

        <div className="p-6 sm:p-8 space-y-4">
          <p className="flex items-start gap-2.5 text-sm text-amber font-medium leading-relaxed">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              This writes clients, sessions and exercise logs straight into{" "}
              <strong>{studioName}</strong>. The client data schema migration is
              still pending, so import one file at a time and check the result
              before running another.
            </span>
          </p>

          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            onChange={handleLegacyFileUpload}
            disabled={isLegacyImporting}
            className="hidden"
          />
          <Button
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={isLegacyImporting}
            className="w-full h-14 rounded-2xl border-dashed border-2 border-amber/40 bg-background text-amber hover:bg-amber/10 font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <Database className="w-4 h-4" />
            {isLegacyImporting ? "Processing legacy data…" : "Choose a CSV to import"}
          </Button>

          {legacyStats && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Clients", legacyStats.clients],
                ["Sessions", legacyStats.sessions],
                ["Logs", legacyStats.logs],
                ["Failed", legacyStats.failed],
              ].map(([label, n]) => (
                <div
                  key={String(label)}
                  className="rounded-2xl border border-border bg-background px-4 py-3"
                >
                  <dt className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    {label}
                  </dt>
                  <dd
                    className={`text-2xl font-black italic ${
                      label === "Failed" && Number(n) > 0
                        ? "text-amber"
                        : "text-foreground"
                    }`}
                  >
                    {n}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {legacyError && (
            <p className="text-sm font-medium text-red-500">{legacyError}</p>
          )}
        </div>
      </section>
    </div>
  );
}
