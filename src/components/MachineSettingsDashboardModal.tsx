import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, X, TrendingUp } from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Machine, ExerciseLog, WorkoutSession, Studio } from "../types";
import { parseSessionDate } from "../lib/utils";

interface Props {
  editingSettings: {
    machineId: string;
    settings: Record<string, string>;
  } | null;
  setEditingSettings: (
    settings: { machineId: string; settings: Record<string, string> } | null,
  ) => void;
  machines: Machine[];
  exerciseLogs: ExerciseLog[];
  sessions: WorkoutSession[];
  isSaving: boolean;
  onSave: () => void;
  studios?: Studio[];
  activeStudioId?: string | null;
}

export function MachineSettingsDashboardModal({
  editingSettings,
  setEditingSettings,
  machines,
  exerciseLogs,
  sessions,
  isSaving,
  onSave,
  studios = [],
  activeStudioId = null,
}: Props) {
  if (!editingSettings) return null;
  const mId = editingSettings.machineId;
  const targetMachine = machines.find((m) => m.id === mId);
  const activeStudio = studios.find((s) => s.id === activeStudioId);
  const standardSettings =
    activeStudio?.machineSettings?.[mId] ||
    targetMachine?.standardSettings ||
    {};

  // Filter logs for this machine
  const machineLogs = exerciseLogs
    .filter((l) => l.machineId === mId && parseInt(l.weight || "0") > 0)
    .sort((a, b) => {
      const sessionA = sessions.find((s) => s.id === a.sessionId);
      const sessionB = sessions.find((s) => s.id === b.sessionId);
      const dateA = sessionA
        ? parseSessionDate(sessionA.date)
        : a.createdAt.toDate().getTime();
      const dateB = sessionB
        ? parseSessionDate(sessionB.date)
        : b.createdAt.toDate().getTime();
      return dateA - dateB;
    });

  // Current weight is from the last log
  const currentLog =
    machineLogs.length > 0 ? machineLogs[machineLogs.length - 1] : null;
  const currentWeight = currentLog
    ? parseInt(currentLog.weight || "0") || 0
    : 0;

  // Calculate PR
  let prLog = null;
  let maxWeight = 0;
  for (const log of machineLogs) {
    const w = parseInt(log.weight || "0") || 0;
    if (w > maxWeight) {
      maxWeight = w;
      prLog = log;
    }
  }

  const prSessionDate = prLog
    ? sessions.find((s) => s.id === prLog.sessionId)?.date || ""
    : "";
  const prDisplayDate = prSessionDate
    ? new Date(parseSessionDate(prSessionDate)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  // Calculate Trend Data
  const trendData = [];

  for (const log of machineLogs) {
    const weight = parseInt(log.weight || "0") || 0;
    if (weight > 0) {
      const session = sessions.find((s) => s.id === log.sessionId);
      if (session) {
        trendData.push({
          sessionDate: new Date(
            parseSessionDate(session.date),
          ).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
          weight,
          reps: log.reps, // for the tooltip
          seconds: log.seconds,
          isStatic:
            log.isStaticHold ||
            log.isTSC ||
            (log.seconds && (!log.reps || parseInt(log.reps) === 0)),
          dateStr: session.date,
        });
      }
    }
  }

  // Use all history for the chart
  const chartData = trendData;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#0f172a] border border-[#1e293b] p-3 rounded-lg shadow-xl">
          <p className="text-[11px] uppercase tracking-widest text-[#68717A] mb-1">
            {data.sessionDate}
          </p>
          <div className="flex items-end gap-2">
            <p className="text-[#F06C22] font-black text-xl leading-none">
              {data.weight} <span className="text-xs">LBS</span>
            </p>
          </div>
          {data.isStatic ? (
            <p className="text-white font-bold text-sm mt-1">
              Hold: {data.seconds}s
            </p>
          ) : (
            <p className="text-white font-bold text-sm mt-1">
              Reps: {data.reps}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <Dialog
      open={!!editingSettings}
      onOpenChange={(open) => !open && setEditingSettings(null)}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[92vw] sm:w-[85vw] max-w-2xl max-h-[85dvh] sm:max-h-[90dvh] overflow-y-auto no-scrollbar bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl sm:rounded-3xl p-0 flex flex-col transition-colors"
      >
        {/* Hero Header */}
        <div className="bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800/80 p-5 sm:p-6 flex flex-col justify-between relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditingSettings(null)}
            className="absolute top-4 right-4 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xs sm:text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
              {targetMachine?.name}
            </h2>
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-3 flex-wrap mt-1">
                <span className="text-4xl sm:text-6xl font-black text-[#F06C22] leading-none tracking-tight">
                  {currentWeight > 0 ? `${currentWeight} LBS` : "---"}
                </span>
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#F06C22]/80">
                  Current Weight
                </span>
              </div>

              {prLog && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700/60 inline-flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs sm:text-sm">
                      PR: {maxWeight} LBS
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 font-medium text-xs">
                      × {prLog.reps} reps
                    </span>
                    {prDisplayDate && (
                      <span className="text-slate-400 text-[10px] uppercase tracking-widest ml-1">
                        ({prDisplayDate})
                      </span>
                    )}
                  </div>

                  {currentLog?.totalTimeUnderLoad !== undefined && (
                    <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700/60 flex flex-col justify-center">
                      {currentLog.isStaticHold ||
                      currentLog.isTSC ||
                      (currentLog.seconds &&
                        (!currentLog.reps ||
                          parseInt(currentLog.reps) === 0)) ? (
                        <span className="text-[#F06C22] font-bold text-xs uppercase tracking-widest">
                          Static Time Under Load:{" "}
                          {currentLog.totalTimeUnderLoad} sec
                        </span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-[#F06C22] font-bold text-xs uppercase tracking-widest">
                            Dynamic Time Under Load:{" "}
                            {currentLog.totalTimeUnderLoad} sec
                          </span>
                          {currentLog.averageTimePerRep !== undefined && (
                            <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-widest mt-0.5">
                              Avg Time/Rep: {currentLog.averageTimePerRep} sec
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Trend Visualization (Middle Section) */}
        <div className="p-4 sm:p-6 bg-slate-100/60 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Load Progression
            </h3>
          </div>
          <div className="h-44 sm:h-52 w-full text-slate-400">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-slate-200 dark:text-slate-800/80"
                  vertical={false}
                />
                <XAxis
                  dataKey="sessionDate"
                  stroke="#64748b"
                  tick={{ fill: "#64748b", fontSize: 10, fontWeight: 700 }}
                  tickMargin={10}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#64748b"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  domain={["dataMin - 10", "dataMax + 10"]}
                />
                <RechartsTooltip
                  content={<CustomTooltip />}
                  cursor={{
                    fill: "currentColor",
                    opacity: 0.15,
                    className: "text-slate-200 dark:text-slate-800",
                  }}
                />
                <Bar
                  dataKey="weight"
                  fill="currentColor"
                  className="text-slate-200 dark:text-slate-800 hover:text-slate-300 dark:hover:text-slate-700"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#F06C22"
                  strokeWidth={3}
                  dot={{ fill: "#F06C22", strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: "#fff", stroke: "#F06C22" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Machine Settings Editor */}
        <div className="p-4 sm:p-6 bg-white dark:bg-slate-900">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3 sm:mb-4 flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#F06C22]" /> Machine Configuration
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-5">
            {targetMachine?.settingOptions?.map((opt) => (
              <div key={opt} className="space-y-1.5">
                <label className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-0.5 flex justify-between items-center pr-0.5">
                  <span>{opt}</span>
                  {standardSettings[opt] && (
                    <span
                      className="text-slate-400 dark:text-slate-500 font-semibold text-[9px] sm:text-[10px]"
                      title="Standard Setting"
                    >
                      STD: {standardSettings[opt]}
                    </span>
                  )}
                </label>
                <Input
                  value={editingSettings.settings[opt] || ""}
                  onChange={(e) =>
                    setEditingSettings({
                      ...editingSettings,
                      settings: {
                        ...editingSettings.settings,
                        [opt]: e.target.value,
                      },
                    })
                  }
                  placeholder={standardSettings[opt] || "--"}
                  className="h-10 sm:h-12 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 focus:border-[#F06C22] focus:ring-[#F06C22] text-base sm:text-lg font-black text-slate-900 dark:text-white px-3 sm:px-4 tabular-nums transition-all shadow-sm"
                />
              </div>
            ))}
          </div>

          <Button
            disabled={isSaving}
            onClick={onSave}
            className="w-full h-12 sm:h-14 rounded-xl bg-[#F06C22] hover:bg-[#D95B16] text-white font-black uppercase tracking-widest text-xs sm:text-sm shadow-lg active:scale-[0.98] transition-all cursor-pointer"
          >
            {isSaving ? "Saving..." : "Save Machine Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
