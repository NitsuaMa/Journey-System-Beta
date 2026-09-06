import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Users,
  Plus,
  AlertCircle,
  Trash2,
  ChevronRight,
  Check,
  Sparkles,
  MessageSquare,
  Zap,
  ChevronLeft,
  Settings2,
  ClipboardList,
  PlusCircle,
  History,
  Loader2,
  Timer,
  ClipboardPenLine,
  Wrench,
  TriangleAlert,
  HeartPulse,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  where,
  setDoc,
  getDocs,
  getDoc,
  limit,
  Timestamp,
} from "firebase/firestore";
import { User as FirebaseUser } from "firebase/auth";

import { db } from "../firebase";
import {
  Client,
  Machine,
  Trainer,
  View,
  WorkoutSession,
  ExerciseLog,
  ClientMachineSetting,
  SessionType,
  TrainerFocus,
  FocusRecord,
  SessionNote,
  Routine,
  PreSessionCheckIn,
} from "../types";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import {
  matchesRoutineLetter,
  routineLetterOf,
  findRoutineByLetter,
} from "../lib/routine-utils";
import {
  parseSessionDate,
  safeToDate,
  orderMachineSettings,
} from "../lib/utils";
import { completeWorkoutSession } from "../lib/sync-utils";
import { getLatestTargetWeight } from "../lib/historical-utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { useActiveStudio } from "../ActiveStudioContext";
import { SetupPromptDialog } from "../features/equipment";
import { useStudioMachineSettings } from "../hooks/useStudioMachineSettings";
import { resolveMachineOrder } from "../data/machine-display-order";
import {
  JourneyGrid,
  QualityLegend,
  SessionNowBar,
  toIsoDate,
  toJourneyRows,
  toJourneySessions,
  type GridSection,
  type LiveColumn,
  type LiveSet,
} from "../features/journey-grid";
import { isBig5Machine } from "../lib/utils";
import type { RepQuality } from "../types";
import { useToast } from "../contexts/ToastContext";
import {
  hasCount,
  hasRequiredCount,
  findIncompleteLogs,
} from "../lib/log-validation";
import { ActiveSessionTimer } from "./ActiveSessionTimer";
import { MachineSheet } from "../features/equipment/MachineSheet";
/* Lazy, and the reason is measurable: the assessment panel is a 162 kB
   chunk (50 kB gzipped) that most sessions never open. A static import
   would put it on the critical path of the one screen a trainer opens
   forty times a day, to pay for a panel they open once a quarter. */
const ClientCheckInPanel = React.lazy(() =>
  import("./journal/ClientCheckInPanel").then((m) => ({ default: m.ClientCheckInPanel })),
);
import { SessionJournalSidebar } from "./journal/SessionJournalSidebar";
import { BriefingScreen } from "../features/briefing";
import { VictoryHUDScreen } from "./VictoryHUDScreen";
import { ConsultationSetupWizard } from "./ConsultationSetupWizard";

type RoutineType = "A" | "B" | "Free";

function ClientSelectionDialog({
  clients,
  onSelect,
  onClose,
  open = true,
  title = "Select Client",
  description = "Choose a client to start their current training session.",
}: {
  clients: Client[];
  onSelect: (id: string) => void;
  onClose: () => void;
  open?: boolean;
  title?: string;
  description?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = clients.filter((c) =>
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-112.5 rounded-3xl p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-black uppercase italic tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="font-bold text-xs">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Find client..."
              className="pl-10 h-11 rounded-xl bg-white dark:bg-bg-dark border-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-6 pt-2 space-y-2">
          {filtered.length > 0 ? (
            filtered.map((client) => (
              <button
                key={client.id}
                onClick={() => onSelect(client.id!)}
                className="w-full text-left p-4 rounded-2xl border-2 border-transparent hover:border-primary/20 hover:bg-primary/5 transition-all flex items-center justify-between group"
              >
                <div>
                  <p className="font-black text-lg leading-tight uppercase">
                    {client.firstName} {client.lastName}
                  </p>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase opacity-60">
                    {client.height} • {client.weight || "--"} lbs
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </button>
            ))
          ) : (
            <div className="py-12 text-center opacity-40">
              <Users className="w-12 h-12 mx-auto mb-2" />
              <p className="text-xs font-black uppercase">No clients found</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


function PerformanceEntryDialog({
  machine,
  currentWeight,
  currentReps,
  currentQuality,
  pastMachineLogs,
  isStaticHold,
  side,
  isTorsoFull,
  currentRepsRight,
  onSave,
  onClose,
  machineSettings,
}: {
  machine: Machine;
  currentWeight: string;
  currentReps: string;
  currentQuality: number;
  pastMachineLogs: { log: ExerciseLog; session: WorkoutSession }[];
  isStaticHold?: boolean;
  side?: "Left" | "Right";
  isTorsoFull?: boolean;
  currentRepsRight?: string;
  onSave: (
    weight: string,
    repsOrSeconds: string,
    quality: number,
    isHold: boolean,
    side?: "Left" | "Right",
    repsRight?: string,
  ) => void;
  onClose: () => void;
  machineSettings?: ClientMachineSetting;
}) {
  const { activeStudio } = useActiveStudio();
  const prevLog = pastMachineLogs[0]?.log;
  const prevWeight = prevLog?.weight || "0";

  const initialWeight =
    parseFloat(currentWeight) > 0
      ? parseFloat(currentWeight)
      : parseFloat(prevWeight) || 0;

  // Deliberately NOT seeded from the previous session. Weight carries forward
  // because a starting load is a setting; a rep or second count is a measurement
  // and must come from this set. Last session's number appears only as a greyed
  // placeholder, and `canSave` below refuses to store an empty field.
  const initialReps = currentReps !== "" ? parseFloat(currentReps) : "";
  const initialRepsRight =
    currentRepsRight !== undefined && currentRepsRight !== ""
      ? parseFloat(currentRepsRight)
      : "";

  const [current, setCurrent] = useState<number>(initialWeight);
  const [reps, setReps] = useState<number | string>(initialReps);
  const [repsRt, setRepsRt] = useState<number | string>(initialRepsRight);
  const [quality, setQuality] = useState<number>(currentQuality || 0);
  const [isHold, setIsHold] = useState(isStaticHold || false);

  const roundUpTo2 = (val: number) => Math.ceil(val / 2) * 2;

  const adjustCurrent = (amount: number) =>
    setCurrent(Math.max(0, roundUpTo2(current + amount)));

  const getBaseReps = (currentVal: string | number, prevValStr: string) => {
    if (typeof currentVal === "number" && currentVal > 0) return currentVal;
    if (typeof currentVal === "string" && currentVal !== "")
      return parseFloat(currentVal);
    return parseFloat(prevValStr) || 0;
  };

  /**
   * A set is only saveable with a quality *and* an actual rep/second count.
   * Previously only quality was required, so a blank field saved an empty value
   * that rendered as "s" with no number and scored zero toward the client's
   * lifetime volume.
   */
  const countsEntered = isTorsoFull
    ? hasCount(reps) && hasCount(repsRt)
    : hasCount(reps);
  const canSave = Boolean(quality) && quality !== 0 && countsEntered;

  const saveLabel = !countsEntered
    ? isHold
      ? "Enter Seconds To Save"
      : "Enter Reps To Save"
    : !quality || quality === 0
      ? "Select Quality To Save"
      : "Save Set";

  const prevRepsLeftPlaceholder = isHold
    ? prevLog?.seconds || ""
    : prevLog?.reps || "";
  const prevRepsRightPlaceholder =
    (prevLog as any)?.repsRight || prevRepsLeftPlaceholder;

  /**
   * Reps and seconds are different units — 8 reps is not 8 seconds — so switching
   * mode re-seeds the field from that mode's own previous value rather than
   * carrying the old number across.
   */
  const switchMode = (hold: boolean) => {
    if (hold === isHold) return;
    setIsHold(hold);
    // Clear rather than carry the number across: the units are different, so a
    // rep count left sitting in the seconds field would be saved as a duration.
    setReps("");
    if (isTorsoFull) setRepsRt("");
  };

  const adjustReps = (amount: number) => {
    const base = getBaseReps(reps, prevRepsLeftPlaceholder);
    setReps(Math.max(0, base + amount));
  };

  const adjustRepsRt = (amount: number) => {
    const base = getBaseReps(repsRt, prevRepsRightPlaceholder);
    setRepsRt(Math.max(0, base + amount));
  };

  const prevW = parseFloat(prevWeight) || 0;
  const weightDelta = prevW > 0 ? current - prevW : 0;
  const weightDeltaPct =
    prevW > 0 ? ((weightDelta / prevW) * 100).toFixed(1) : "0.0";

  const settings = machineSettings?.settings || {};
  const hasSettings = Object.keys(settings).length > 0;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-100 rounded-[32px] p-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-bg-dark shadow-2xl dark:shadow-none flex flex-col h-full max-h-[85vh] sm:max-h-150">
        {/* Header */}
        <div className="bg-white dark:bg-bg-dark p-4 text-slate-900 dark:text-white relative overflow-hidden border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="absolute top-0 right-0 p-8 opacity-5 rotate-12">
            <Zap className="w-24 h-24" />
          </div>
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-sky-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black italic uppercase tracking-tight leading-none truncate">
                {machine.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {side && (
                  <span className="text-orange-500 text-[11px] font-black uppercase tracking-widest leading-none">
                    Rotation: {side}
                  </span>
                )}
                {side && <span className="w-1 h-1 bg-slate-600 rounded-full" />}
                <p className="text-[11px] uppercase font-bold text-sky-500 tracking-widest leading-none">
                  Entry HUD
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* Settings Shorthand Bar */}
          <div className="bg-slate-50/40 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-2.5 flex items-center justify-center gap-x-5 gap-y-1.5 flex-wrap">
            {(() => {
              const stdSettings =
                activeStudio?.machineSettings?.[machine.id!] ||
                machine.standardSettings ||
                {};
              const options = machine.settingOptions || [];
              const sorted = orderMachineSettings(
                settings,
                stdSettings,
                options,
              );
              return sorted.map(([key, value, originalKey], i) => (
                <div
                  key={originalKey || i}
                  className="flex items-center gap-1.5"
                >
                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tighter">
                    {key}:
                  </span>
                  <span className="text-[12px] font-black text-orange-500 italic">
                    {value}
                  </span>
                </div>
              ));
            })()}
          </div>

          {/* Smart Stepper: Weight */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col items-center relative">
            <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest text-center block mb-2">
              Weight (lbs)
            </Label>
            <div className="flex items-center justify-between w-full h-14 px-1">
              <button
                className="w-11 h-11 rounded-xl bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-black text-lg flex items-center justify-center active:scale-95 transition-transform border border-slate-300 dark:border-slate-700"
                onClick={() => adjustCurrent(-2)}
              >
                -2
              </button>

              <div className="flex flex-col items-center justify-center flex-1">
                <input
                  type="number"
                  inputMode="decimal"
                  value={current || ""}
                  onChange={(e) => setCurrent(parseFloat(e.target.value) || 0)}
                  className="font-black text-5xl text-slate-900 dark:text-white tracking-tighter leading-none bg-transparent border-none text-center w-full p-0 m-0 no-arrows focus:ring-0"
                />
                {prevW > 0 && (
                  <div
                    className={`mt-0.5 text-[11px] font-black uppercase px-1.5 py-0.5 rounded-md ${weightDelta > 0 ? "bg-emerald-500/20 text-emerald-400" : weightDelta < 0 ? "bg-rose-500/20 text-rose-400" : "bg-slate-700 text-slate-500 dark:text-slate-400"}`}
                  >
                    {weightDelta > 0 ? "+" : ""}
                    {weightDelta} lbs ({weightDelta > 0 ? "+" : ""}
                    {weightDeltaPct}%)
                  </div>
                )}
              </div>

              <button
                className="w-11 h-11 rounded-xl bg-orange-500 dark:bg-orange-600 text-white font-black text-lg flex items-center justify-center shadow-[0_4px_12px_rgba(240,108,34,0.3)] active:scale-95 transition-transform"
                onClick={() => adjustCurrent(2)}
              >
                +2
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* Smart Stepper: Reps / Seconds */}
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col items-center relative">
              <div className="flex items-center justify-center gap-1.5 bg-white dark:bg-bg-dark border border-slate-200 dark:border-slate-800 rounded-xl p-1 mb-2.5 w-full max-w-45">
                <button
                  onClick={() => switchMode(false)}
                  className={`flex-1 h-6 rounded-lg font-black uppercase text-[11px] tracking-widest transition-all ${!isHold ? "bg-sky-500 text-slate-900 dark:text-white" : "text-slate-600 hover:text-slate-500 dark:text-slate-400"}`}
                >
                  REPS
                </button>
                <button
                  onClick={() => switchMode(true)}
                  className={`flex-1 h-6 rounded-lg font-black uppercase text-[11px] tracking-widest transition-all ${isHold ? "bg-sky-500 text-slate-900 dark:text-white" : "text-slate-600 hover:text-slate-500 dark:text-slate-400"}`}
                >
                  TSC
                </button>
              </div>

              {!isTorsoFull ? (
                <div className="flex items-center justify-between w-full h-12 px-1">
                  <button
                    className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-black text-lg flex items-center justify-center active:scale-95 transition-transform border border-slate-300 dark:border-slate-700 shrink-0"
                    onClick={() => adjustReps(-1)}
                  >
                    -1
                  </button>

                  <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={reps || ""}
                      onChange={(e) =>
                        setReps(
                          e.target.value === ""
                            ? ""
                            : parseFloat(e.target.value) || 0,
                        )
                      }
                      placeholder={prevRepsLeftPlaceholder}
                      className="font-black text-4xl text-slate-900 dark:text-white tracking-tight leading-none bg-transparent border-none text-center w-full p-0 m-0 no-arrows focus:ring-0 placeholder:text-slate-600/50"
                    />
                  </div>

                  <button
                    className="w-10 h-10 rounded-xl bg-sky-500 text-slate-900 dark:text-white font-black text-lg flex items-center justify-center shadow-[0_4px_12px_rgba(56,189,248,0.3)] active:scale-95 transition-transform shrink-0"
                    onClick={() => adjustReps(1)}
                  >
                    +1
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4 w-full px-1">
                  <div className="flex flex-col items-center flex-1 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-1">
                      Left ({isHold ? "SEC" : "REPS"})
                    </span>
                    <div className="flex items-center justify-between w-full h-10">
                      <button
                        onClick={() => adjustReps(-1)}
                        className="w-8 h-8 rounded-lg bg-slate-700/50 text-slate-500 dark:text-slate-400 font-black text-sm flex items-center justify-center active:scale-95 border border-slate-300/30 shrink-0"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={reps || ""}
                        onChange={(e) =>
                          setReps(
                            e.target.value === ""
                              ? ""
                              : parseFloat(e.target.value) || 0,
                          )
                        }
                        placeholder={prevRepsLeftPlaceholder}
                        className="font-black text-2xl text-slate-900 dark:text-white tracking-tight leading-none bg-transparent border-none text-center w-full p-0 m-0 no-arrows focus:ring-0 min-w-0 placeholder:text-slate-600/50"
                      />
                      <button
                        onClick={() => adjustReps(1)}
                        className="w-8 h-8 rounded-lg bg-sky-500 text-slate-900 dark:text-white font-black text-sm flex items-center justify-center shadow-lg active:scale-95 shrink-0"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-center flex-1 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-1">
                      Right ({isHold ? "SEC" : "REPS"})
                    </span>
                    <div className="flex items-center justify-between w-full h-10">
                      <button
                        onClick={() => adjustRepsRt(-1)}
                        className="w-8 h-8 rounded-lg bg-slate-700/50 text-slate-500 dark:text-slate-400 font-black text-sm flex items-center justify-center active:scale-95 border border-slate-300/30 shrink-0"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={repsRt || ""}
                        onChange={(e) =>
                          setRepsRt(
                            e.target.value === ""
                              ? ""
                              : parseFloat(e.target.value) || 0,
                          )
                        }
                        placeholder={prevRepsRightPlaceholder}
                        className="font-black text-2xl text-slate-900 dark:text-white tracking-tight leading-none bg-transparent border-none text-center w-full p-0 m-0 no-arrows focus:ring-0 min-w-0 placeholder:text-slate-600/50"
                      />
                      <button
                        onClick={() => adjustRepsRt(1)}
                        className="w-8 h-8 rounded-lg bg-sky-500 text-slate-900 dark:text-white font-black text-sm flex items-center justify-center shadow-lg active:scale-95 shrink-0"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quality Rating */}
            <div
              className={`bg-slate-50 dark:bg-slate-950 border rounded-2xl p-3 flex flex-col items-center relative transition-colors ${!quality || quality === 0 ? "border-amber-500/50 dark:border-amber-500/40" : "border-slate-200 dark:border-slate-800"}`}
            >
              <Label className="text-[11px] font-black uppercase tracking-widest text-center block mb-2.5 items-center gap-1 text-slate-500 dark:text-slate-400">
                Set Quality / RPE{" "}
                {!quality && (
                  <span className="text-amber-500 font-bold text-xs">
                    * Required
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-1.5 w-full h-9">
                <button
                  onClick={() => setQuality(1)}
                  className={`flex-1 h-full rounded-xl font-black uppercase text-[11px] tracking-widest transition-all ${quality === 1 ? "bg-rose-500 text-slate-900 dark:text-white shadow-[0_4px_10px_rgba(244,63,94,0.3)]" : "bg-white border border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-500 dark:text-slate-400"}`}
                >
                  Poor
                </button>
                <button
                  onClick={() => setQuality(2)}
                  className={`flex-1 h-full rounded-xl font-black uppercase text-[11px] tracking-widest transition-all ${quality === 2 ? "bg-amber-500 text-slate-900 dark:text-white shadow-[0_4px_10px_rgba(245,158,11,0.3)]" : "bg-white border border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-500 dark:text-slate-400"}`}
                >
                  Completed
                </button>
                <button
                  onClick={() => setQuality(3)}
                  className={`flex-1 h-full rounded-xl font-black uppercase text-[11px] tracking-widest transition-all ${quality === 3 ? "bg-emerald-500 text-slate-900 dark:text-white shadow-[0_4px_10px_rgba(16,185,129,0.3)]" : "bg-white border border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-500 dark:text-slate-400"}`}
                >
                  Max Strength
                </button>
              </div>
            </div>
          </div>

          {/* Trend History */}
          {pastMachineLogs.length > 0 && (
            <div className="bg-slate-50/30 border border-slate-200 dark:border-slate-800/50 rounded-xl p-2.5 flex flex-col gap-1.5">
              <div className="flex justify-between items-center px-1">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  Trend History
                </span>
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                  Last 3 Sets
                </span>
              </div>
              {pastMachineLogs.map((entry, idx) => {
                const isHoldLog = entry.log.isStaticHold;
                let metrics = "";
                if (
                  entry.log.repsLeft !== undefined &&
                  entry.log.repsRight !== undefined
                ) {
                  metrics = `${entry.log.repsLeft}L|${entry.log.repsRight}R`;
                } else {
                  metrics = isHoldLog
                    ? `${entry.log.seconds}s`
                    : `${entry.log.reps}R`;
                }

                const olderEntry = pastMachineLogs[idx + 1];
                let arrow = null;
                if (olderEntry && olderEntry.log.weight) {
                  const currW = parseFloat(entry.log.weight || "0");
                  const oldW = parseFloat(olderEntry.log.weight || "0");
                  if (currW > oldW) {
                    arrow = (
                      <span className="text-emerald-500 font-bold ml-1 text-[11px]">
                        ↑
                      </span>
                    );
                  } else if (currW < oldW) {
                    arrow = (
                      <span className="text-rose-500 font-bold ml-1 text-[11px]">
                        ↓
                      </span>
                    );
                  }
                }

                return (
                  <div
                    key={idx}
                    className="flex justify-between items-center text-[11px] bg-slate-50 dark:bg-slate-950 rounded-lg px-2 py-1.5 border border-slate-200 dark:border-slate-800/30"
                  >
                    <span className="text-slate-500 dark:text-slate-400 font-bold uppercase text-[11px]">
                      {new Date(
                        parseSessionDate(entry.session.date),
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="font-black text-slate-700 dark:text-slate-300 flex items-center tabular-nums">
                      {entry.log.weight}
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-0.5">
                        lbs
                      </span>
                      <span className="mx-1.5 text-slate-700 dark:text-slate-300">
                        |
                      </span>
                      {metrics}
                      {arrow}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="p-4 bg-white dark:bg-bg-dark border-t border-slate-200 dark:border-slate-800 shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-3 shadow-[0_-10px_20px_rgba(0,0,0,0.2)]">
          <Button
            variant="outline"
            className="h-12 rounded-xl font-black uppercase text-[11px] tracking-widest border border-slate-300 dark:border-slate-700 bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-50 transition-all shadow-md"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="h-12 rounded-xl font-black uppercase text-[11px] tracking-widest bg-orange-500 dark:bg-orange-600 text-white hover:bg-orange-600 dark:hover:bg-orange-700 shadow-[0_4px_15px_rgba(240,108,34,0.4)] border-none active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave(
                current.toString(),
                reps.toString(),
                quality,
                isHold,
                side,
                repsRt.toString(),
              );
            }}
          >
            {saveLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExerciseHistoryDialog({
  clientId,
  machine,
  onClose,
  user,
}: {
  clientId: string;
  machine: Machine;
  onClose: () => void;
  user: any;
}) {
  const [history, setHistory] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !machine.id || !clientId) return;
    const q = query(
      collection(db, "exerciseLogs"),
      where("clientId", "==", clientId),
      where("machineId", "==", machine.id),
      orderBy("createdAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const logs = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as ExerciseLog,
        );
        setHistory(logs);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "exerciseLogs");
      },
    );

    return () => unsubscribe();
  }, [clientId, machine.id, user]);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-125 h-[80vh] flex flex-col rounded-3xl p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-black uppercase italic tracking-tight flex items-center gap-2">
            <History className="w-6 h-6 text-primary" />
            {machine.name} History
          </DialogTitle>
          <DialogDescription className="font-bold text-xs">
            Performance tracking from origin to present.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-20 opacity-50 space-y-2">
              <ClipboardList className="w-12 h-12 mx-auto" />
              <p className="font-bold uppercase text-xs">
                No historical data found
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((log, idx) => {
                const isOrigin = idx === history.length - 1;
                return (
                  <div
                    key={log.id}
                    className={`p-4 rounded-2xl border transition-all ${isOrigin ? "bg-primary/5 border-primary/20 ring-1 ring-primary/10" : "bg-white dark:bg-surface-1"}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-muted-foreground uppercase">
                          {safeToDate(log.createdAt)?.toLocaleDateString() ||
                            "Recent"}
                        </span>
                        {isOrigin && (
                          <Badge className="bg-primary text-slate-900 dark:text-white text-[11px] font-black rounded px-1.5 h-4 border-none uppercase">
                            Origin
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {log.isStaticHold && (
                          <Badge
                            variant="outline"
                            className="text-[11px] border-primary text-primary h-4"
                          >
                            Static
                          </Badge>
                        )}
                        {log.notes && (
                          <MessageSquare className="w-3 h-3 text-primary/40" />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-black text-muted-foreground uppercase">
                          Weight
                        </p>
                        <p className="text-xl font-black">
                          {log.weight}{" "}
                          <span className="text-[11px] font-normal italic">
                            lbs
                          </span>
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-black text-muted-foreground uppercase">
                          {log.isStaticHold ? "Seconds" : "Reps"}
                        </p>
                        <p
                          className={`text-xl font-black ${
                            log.repQuality === 3
                              ? "text-emerald-500"
                              : log.repQuality === 2
                                ? "text-amber-500"
                                : log.repQuality === 1
                                  ? "text-red-500"
                                  : ""
                          }`}
                        >
                          {log.isStaticHold
                            ? log.seconds || "0"
                            : log.reps || "0"}
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[11px] font-black text-muted-foreground uppercase">
                          Quality
                        </p>
                        <div
                          className={`w-fit px-2 py-0.5 rounded-full text-[11px] font-black text-slate-900 dark:text-white ${
                            log.repQuality === 3
                              ? "bg-emerald-500"
                              : log.repQuality === 2
                                ? "bg-amber-500"
                                : log.repQuality === 1
                                  ? "bg-red-500"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {log.repQuality === 3
                            ? "MAX STRENGTH"
                            : log.repQuality === 2
                              ? "COMPLETED"
                              : log.repQuality === 1
                                ? "POOR"
                                : "NONE"}
                        </div>
                      </div>
                    </div>

                    {log.notes && (
                      <div className="mt-3 text-[11px] bg-white dark:bg-bg-dark p-2 rounded-lg font-medium text-muted-foreground border-l-2 border-primary/30 italic">
                        "{log.notes}"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** How long a locally-created session is protected from being cleared by a
 *  snapshot that has not caught up with the write yet. */
const JUST_STARTED_GRACE_MS = 15000;

/** Milliseconds from a Firestore Timestamp, Date, or ISO string; null if absent. */
function toMillisOrNull(value: any): number | null {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Tracker grid column widths (iPad-first).
 *
 * Every column is a fixed width and the FILLER between the History grid and
 * the input columns is the only flexible cell, so WEIGHT / REPS / QUALITY are
 * always pinned to the right edge — under the trainer's right thumb — no
 * matter how many history cells a machine has. The widths step up with the
 * viewport so the whole row fits without sideways scrolling on iPad portrait
 * (md), landscape (lg) and 12.9" landscape (xl).
 */
const TRACKER_COL = {
  seq: "w-12 shrink-0",
  notes: "w-10 shrink-0",
  exercise: "w-40 md:w-44 lg:w-56 xl:w-64 shrink-0",
  /** Starting Weight / Last Weight Performed — reference only, centered. */
  reference: "w-14 lg:w-16 shrink-0 text-center",
  spacer: "w-3 shrink-0",
  history: "w-12 lg:w-15 shrink-0",
  /** Absorbs ALL leftover width; never capped. */
  filler: "flex-1 min-w-0",
  /** WEIGHT / REPS / QUALITY — the thumb columns. */
  input: "w-16 lg:w-20 xl:w-24 shrink-0",
} as const;

/** The two OLDEST history columns hide on iPad portrait to keep the row on-screen. */
const historyVisibility = (i: number) => (i >= 3 ? "hidden lg:flex" : "flex");

export function WorkoutTrackerView({
  clientId,
  clients,
  machines,
  trainers,
  user,
  setView,
  setSelectedClientId,
  showClientPicker,
  setShowClientPicker,
  onStartNewClientOnboarding,
  setClientFormData,
  onOpenInfo,
  authTrainer,
  trainerFocuses,
  isSyncing,
  setIsSyncing,
  schedules,
  isIntroSession,
  rightControls,
  trainerDropdown,
  onStudioClick,
}: {
  clientId: string | null;
  clients: Client[];
  machines: Machine[];
  schedules: any[];
  trainers: Trainer[];
  user: FirebaseUser;
  setView: (v: View, data?: { isIntroSession?: boolean }) => void;
  setSelectedClientId: (id: string | null) => void;
  showClientPicker: boolean;
  setShowClientPicker: (v: boolean) => void;
  onStartNewClientOnboarding: (v: string) => void;
  setClientFormData: (v: any) => void;
  onOpenInfo: (m: Machine) => void;
  authTrainer: Trainer | null;
  trainerFocuses: TrainerFocus[];
  isSyncing: boolean;
  setIsSyncing: (v: boolean) => void;
  isIntroSession?: boolean;
  rightControls?: React.ReactNode;
  trainerDropdown?: React.ReactNode;
  onStudioClick?: () => void;
}) {
  const { activeStudioId: contextActiveStudioId, activeStudio } =
    useActiveStudio();
  // Per-studio machine display order (Aug 2026) — same resolution chain
  // as the Client Profile Journey grid: studio override, else the shared
  // default sequence (data/machine-display-order.ts), else legacy
  // machine.order. Kinematic MOVEMENT_PATTERN_ORDER grouping (Edit Routine
  // drawer / Catalog) is a separate, untouched system.
  const { settingsByMachineId: studioMachineSettingsById } =
    useStudioMachineSettings(contextActiveStudioId);

  const { error: toastError, success: toastSuccess } = useToast();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [logs, setLogs] = useState<Record<string, ExerciseLog>>({});
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [currentSession, setCurrentSession] = useState<WorkoutSession | null>(
    null,
  );

  // The 5-session window that drives the Active Session table's History
  // grid — hoisted up here (round: global date headers) so both the
  // <thead> date columns AND the machine rows below can read the exact
  // same 5 sessions. Sessions is already sorted newest-first, so this is
  // simply the 5 most recent past sessions, excluding the in-progress one.
  // IMPORTANT: this must stay above every early `return` in this component
  // (Rules of Hooks) — it was previously declared right before the main
  // JSX return, after several conditional returns, which crashed with
  // "Rendered more hooks than during the previous render" the first time a
  // render's hook count differed (e.g. transitioning from no-client to
  // client-selected). Fixed Aug 29 by moving it here, below the sessions/
  // currentSession state it reads.
  const recentSessions = useMemo(
    () =>
      sessions
        .filter((s) => (currentSession ? s.id !== currentSession.id : true))
        .slice(0, 5),
    [sessions, currentSession],
  );
  const [activeMachineIds, setActiveMachineIds] = useState<string[]>([]);
  const [clientMachineSettings, setClientMachineSettings] = useState<
    Record<string, ClientMachineSetting>
  >({});
  const [focusRecords, setFocusRecords] = useState<FocusRecord[]>([]);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);
  const [currentSessionNotes, setCurrentSessionNotes] = useState<string>("");
  const lastMachineLoggedAt = React.useRef<number>(Date.now());
  const pauseStartTime = React.useRef<number | null>(null);
  const currentSegmentPauseDuration = React.useRef<number>(0);

  /**
   * When the trainer arrived at each machine.
   *
   * Time under tension used to come off ONE shared clock: whichever machine
   * was first in `activeMachineIds` with a finished-but-untimed set consumed
   * the whole elapsed window, and the clock reset. Attribution was therefore
   * decided by array position, which is exactly the thing a trainer now
   * changes mid-session — so reordering silently moved a machine's minutes
   * onto its neighbour, and going back to correct an earlier set charged it
   * with all the time spent elsewhere in between.
   *
   * A clock per machine, started when the trainer moves to it, removes the
   * dependency on order entirely. Nothing about the measurement changes; only
   * the question of whose time it is.
   */
  const machineStartedAt = React.useRef<Record<string, number>>({});

  /** Mark a machine as being worked, unless it already is. */
  const markMachineStarted = React.useCallback((machineId: string) => {
    if (!machineId) return;
    if (machineStartedAt.current[machineId] === undefined) {
      machineStartedAt.current[machineId] = Date.now();
    }
  }, []);

  /** When this machine's set began. Falls back to the shared clock for a
   *  machine completed without ever being focused or touched. */
  const startedAtFor = React.useCallback(
    (machineId: string) =>
      machineStartedAt.current[machineId] ?? lastMachineLoggedAt.current,
    [],
  );
  const [isEditingRoutine, setIsEditingRoutine] = useState(false);
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);
  // Which machine the unified sheet is open on. One piece of state, because
  // there is now one sheet: it used to be two (settings, notes) and a
  // trainer had to know which of two targets to hit.
  const [sheetMachineId, setSheetMachineId] = useState<string | null>(null);
  // The 90-day assessment, opened mid-session. See the panel at the bottom
  // of this file for why it is a slide-over and not a screen.
  const [isShowingAssessment, setIsShowingAssessment] = useState(false);
  const [editingWeightMachineId, setEditingWeightMachineId] = useState<
    string | null
  >(null);

  // ── In-session setup prompt ──────────────────────────────────────────
  // A machine this client has never performed needs a setup, not an empty
  // weight field. When the trainer opens one, show the guide first.
  //
  // `setupPromptedRef` makes it fire ONCE per machine per mount: dismissing
  // the prompt must not turn into a loop every time the HUD is reopened, and a
  // trainer who chose "Skip for now" has already answered the question.
  const [setupPromptMachineId, setSetupPromptMachineId] = useState<
    string | null
  >(null);
  const setupPromptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const machineId = editingWeightMachineId;
    if (!machineId || setupPromptedRef.current.has(machineId)) return;

    const preset = clientMachineSettings[machineId];
    const hasSettings = Boolean(
      preset?.settings && Object.keys(preset.settings).length > 0,
    );
    const hasWeights =
      preset?.startingWeight != null || preset?.currentWeight != null;
    // Log keys are `${sessionId}_${machineId}` with an optional `_Left`/`_Right`
    // suffix, so match on the machine id as a whole segment rather than a
    // substring — "leg_press" must not match "leg_press_unilateral".
    const hasHistory = Object.keys(logs).some((k) => {
      const rest = k.slice(k.indexOf("_") + 1);
      return rest === machineId || rest.startsWith(`${machineId}_`);
    });

    if (hasSettings || hasWeights || hasHistory) return;

    setupPromptedRef.current.add(machineId);
    setSetupPromptMachineId(machineId);
  }, [editingWeightMachineId, clientMachineSettings, logs]);
  const [isStaticHoldOverride, setIsStaticHoldOverride] = useState(false);
  const [historyMachineId, setHistoryMachineId] = useState<string | null>(null);
  const [isSettingUpRoutine, setIsSettingUpRoutine] = useState(false);
  const [showAllMachines, setShowAllMachines] = useState(false);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [lastRoutineLogs, setLastRoutineLogs] = useState<
    Record<string, ExerciseLog>
  >({});
  const [isPreSessionMode, setIsPreSessionMode] = useState(false);
  const [isAdjustingProtocol, setIsAdjustingProtocol] = useState(false);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [adjustmentScope, setAdjustmentScope] = useState<"once" | "permanent">(
    "once",
  );
  const [adjustedMachineIds, setAdjustedMachineIds] = useState<string[]>([]);
  const [preSessionSelectedRoutine, setPreSessionSelectedRoutine] =
    useState<RoutineType>("A");
  const [targetRoutine, setTargetRoutine] = useState<Routine | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  /**
   * Pause/resume, recorded on the session document.
   *
   * Pausing stores the instant; resuming folds that span into totalPausedMs.
   * Keeping it here rather than in component state means a refresh mid-pause no
   * longer counts the break as training time.
   */
  const toggleSessionPause = async () => {
    const session = currentSession;
    if (!session?.id) {
      setIsPaused((p) => !p);
      return;
    }

    const pausedAtMs = toMillisOrNull(session.pausedAt);
    const alreadyPaused = pausedAtMs !== null;

    // Update locally first so the button responds immediately.
    setIsPaused(!alreadyPaused);

    const updates = alreadyPaused
      ? {
          pausedAt: null,
          totalPausedMs:
            (Number(session.totalPausedMs) || 0) +
            Math.max(0, Date.now() - pausedAtMs),
        }
      : { pausedAt: Timestamp.now() };

    setCurrentSession((prev) =>
      prev && prev.id === session.id
        ? ({ ...prev, ...updates } as WorkoutSession)
        : prev,
    );

    try {
      await updateDoc(doc(db, "sessions", session.id), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "sessions");
    }
  };

  /**
   * Set the instant a session is created locally. Firestore's snapshot can lag a
   * beat behind the write, and without this the very next snapshot would report
   * "no session in progress" and immediately clear the one just started.
   */
  const justStartedSessionRef = useRef<{
    id: string;
    clientId: string;
    at: number;
  } | null>(null);

  const [machineTimeElapsed, setMachineTimeElapsed] = useState<number>(0);

  useEffect(() => {
    const takeoverSessionId = localStorage.getItem(
      "max_strength_active_session_id",
    );
    if (takeoverSessionId && !currentSession) {
      const fetchTakeoverSession = async () => {
        try {
          const sRef = doc(db, "sessions", takeoverSessionId);
          const sSnap = await getDoc(sRef);
          if (sSnap.exists()) {
            const data = { id: sSnap.id, ...sSnap.data() } as WorkoutSession;
            if (data.status === "In-Progress") {
              setCurrentSession(data);
              setSessions([data]);
              setIsPreSessionMode(false);
              setShowRoutinePicker(false);
              // Clear it so we don't keep doing this if the trainer navigates away and back manually
              localStorage.removeItem("max_strength_active_session_id");
            }
          }
        } catch (error) {
          console.error("Error fetching takeover session:", error);
        }
      };
      fetchTakeoverSession();
    }
  }, []);

  useEffect(() => {
    if (!currentSession) return;
    let didUpdate = false;

    // Check all logs for the current session to see if any are "completed" but lack timeSpent
    activeMachineIds.forEach((mId) => {
      const isTorso = mId === "torso_rotation"; // Using specific id match based on earlier logic
      if (isTorso) {
        const logL = logs[`${currentSession.id}_${mId}_Left`];
        const logR = logs[`${currentSession.id}_${mId}_Right`];

        if (
          logL?.weight &&
          (logL?.reps || logL?.seconds) &&
          logL?.repQuality &&
          !logL?.timeSpent
        ) {
          const manualSeconds = logL?.seconds ? parseFloat(logL.seconds) : 0;
          const rawTimeDiff = Math.floor(
            (Date.now() - startedAtFor(mId)) / 1000,
          );
          const computedTimeDiff = Math.max(
            0,
            Math.floor(
              (Date.now() -
                startedAtFor(mId) -
                currentSegmentPauseDuration.current) /
                1000,
            ),
          );
          const timeDiff = manualSeconds > 0 ? manualSeconds : computedTimeDiff;
          const isStatic =
            logL.isStaticHold ||
            logL.isTSC ||
            (logL.seconds && (!logL.reps || parseInt(logL.reps) === 0));
          const reps = parseInt(logL.reps || "0");
          const avgTime =
            !isStatic && reps > 0
              ? parseFloat((timeDiff / reps).toFixed(1))
              : undefined;

          updateLogMultiple(
            currentSession.id,
            mId,
            {
              timeSpent: rawTimeDiff.toString(),
              totalTimeUnderLoad: timeDiff,
              machineDurationSeconds: timeDiff,
              ...(avgTime !== undefined && { averageTimePerRep: avgTime }),
            },
            "Left",
          );
          delete machineStartedAt.current[mId];
          lastMachineLoggedAt.current = Date.now();
          currentSegmentPauseDuration.current = 0;
          didUpdate = true;
        }
        if (
          logR?.weight &&
          (logR?.reps || logR?.seconds) &&
          logR?.repQuality &&
          !logR?.timeSpent
        ) {
          const manualSeconds = logR?.seconds ? parseFloat(logR.seconds) : 0;
          const rawTimeDiff = Math.floor(
            (Date.now() - startedAtFor(mId)) / 1000,
          );
          const computedTimeDiff = Math.max(
            0,
            Math.floor(
              (Date.now() -
                startedAtFor(mId) -
                currentSegmentPauseDuration.current) /
                1000,
            ),
          );
          const timeDiff = manualSeconds > 0 ? manualSeconds : computedTimeDiff;
          const isStatic =
            logR.isStaticHold ||
            logR.isTSC ||
            (logR.seconds && (!logR.reps || parseInt(logR.reps) === 0));
          const reps = parseInt(logR.reps || "0");
          const avgTime =
            !isStatic && reps > 0
              ? parseFloat((timeDiff / reps).toFixed(1))
              : undefined;

          updateLogMultiple(
            currentSession.id,
            mId,
            {
              timeSpent: rawTimeDiff.toString(),
              totalTimeUnderLoad: timeDiff,
              machineDurationSeconds: timeDiff,
              ...(avgTime !== undefined && { averageTimePerRep: avgTime }),
            },
            "Right",
          );
          delete machineStartedAt.current[mId];
          lastMachineLoggedAt.current = Date.now();
          currentSegmentPauseDuration.current = 0;
          didUpdate = true;
        }
      } else {
        const log = logs[`${currentSession.id}_${mId}`];
        if (
          log?.weight &&
          (log?.reps || log?.seconds) &&
          log?.repQuality &&
          !log?.timeSpent
        ) {
          const manualSeconds = log?.seconds ? parseFloat(log.seconds) : 0;
          const rawTimeDiff = Math.floor(
            (Date.now() - startedAtFor(mId)) / 1000,
          );
          const computedTimeDiff = Math.max(
            0,
            Math.floor(
              (Date.now() -
                startedAtFor(mId) -
                currentSegmentPauseDuration.current) /
                1000,
            ),
          );
          const timeDiff = manualSeconds > 0 ? manualSeconds : computedTimeDiff;
          const isStatic =
            log.isStaticHold ||
            log.isTSC ||
            (log.seconds && (!log.reps || parseInt(log.reps) === 0));
          const reps = parseInt(log.reps || "0");
          const avgTime =
            !isStatic && reps > 0
              ? parseFloat((timeDiff / reps).toFixed(1))
              : undefined;

          updateLogMultiple(currentSession.id, mId, {
            timeSpent: rawTimeDiff.toString(),
            totalTimeUnderLoad: timeDiff,
            machineDurationSeconds: timeDiff,
            ...(avgTime !== undefined && { averageTimePerRep: avgTime }),
          });
          delete machineStartedAt.current[mId];
          lastMachineLoggedAt.current = Date.now();
          currentSegmentPauseDuration.current = 0;
          didUpdate = true;
        }
      }
    });

    if (didUpdate) {
      // Optional: Since it auto-advances focus, we could log that time tracked.
    }
  }, [logs, currentSession, activeMachineIds]);

  // Mirror the session's persisted pause state into local state, so per-machine
  // timing and the heartbeat also know the session is paused after a refresh.
  useEffect(() => {
    const paused = toMillisOrNull((currentSession as any)?.pausedAt) !== null;
    setIsPaused((prev) => (prev === paused ? prev : paused));
  }, [(currentSession as any)?.pausedAt, currentSession?.id]);

  useEffect(() => {
    if (!currentSession) return;
    if (isPaused) {
      if (!pauseStartTime.current) {
        pauseStartTime.current = Date.now();
      }
    } else {
      if (pauseStartTime.current) {
        currentSegmentPauseDuration.current +=
          Date.now() - pauseStartTime.current;
        pauseStartTime.current = null;
      }
    }
  }, [isPaused, currentSession]);

  useEffect(() => {
    if (!currentSession || isPaused) return;
    const interval = setInterval(() => {
      // Auto-abandon session if left open for > 60 minutes of active time to prevent infinite timers and resource consumption
      const start = currentSession.startTime?.toDate
        ? currentSession.startTime.toDate()
        : new Date(currentSession.startTime);
      const totalSessionMinutes =
        (Date.now() - start.getTime() - currentSegmentPauseDuration.current) /
        60000;
      if (totalSessionMinutes > 60) {
        if (currentSession.id) {
          deleteSession(currentSession.id);
        }
        return;
      }

      let extraPause = 0;
      if (isPaused && pauseStartTime.current) {
        extraPause = Date.now() - pauseStartTime.current;
      }
      setMachineTimeElapsed(
        Math.max(
          0,
          Math.floor(
            (Date.now() -
              lastMachineLoggedAt.current -
              currentSegmentPauseDuration.current -
              extraPause) /
              1000,
          ),
        ),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [currentSession, isPaused]);

  // Fetch all exercise logs for analysis (limited to last 1000 for performance)
  const [isShowingSessionNotes, setIsShowingSessionNotes] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [isPostSessionMode, setIsPostSessionMode] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [pendingAssignSession, setPendingAssignSession] =
    useState<WorkoutSession | null>(null);
  /**
   * Reorder mode.
   *
   * This replaced a 20rem inline panel that rendered the whole shared builder
   * above the grid. It worked, and it was the wrong shape for the moment it
   * is used in: it covered the thing the trainer was reading, to let them do
   * one small thing to it. Adding a machine already happens in place — the
   * "+" on any machine not in today's routine — so what was actually missing
   * was a way to change the order, and that fits in the cell the machine name
   * already occupies.
   */
  const [isReorderMode, setIsReorderMode] = useState(false);

  /**
   * Every mid-session change to the machine list lands here, and lands
   * immediately — no staging buffer, no Confirm step.
   *
   * This was a modal with a Cancel/Confirm footer, which meant a trainer with
   * a client waiting had to open a dialog, make the change, and then agree
   * with themselves before the screen caught up. Session state is local and
   * nothing is written to Firestore either way, so there was never anything
   * for the confirm step to protect.
   */
  /**
   * Record the sequence this session is actually running.
   *
   * Writes to the SESSION document, never the routine. The client's
   * prescription is unchanged; what changed is the history of this workout,
   * and that is worth keeping — a trainer looking back at why a session went
   * the way it did should be able to see that the Leg Press came out and the
   * Pulldown moved up.
   *
   * Fire-and-forget: the trainer's screen updates on the state change, and a
   * failed write costs the recorded order, not the workout.
   */
  const applySessionMachineIds = (newIds: string[]) => {
    setActiveMachineIds(newIds);
    const sessionId = currentSession?.id;
    if (!sessionId) return;
    updateDoc(doc(db, "sessions", sessionId), {
      sessionMachineIds: newIds,
      lastHeartbeatAt: serverTimestamp(),
    }).catch((error) =>
      handleFirestoreError(error, OperationType.UPDATE, "sessions"),
    );
  };

  const handleSaveSessionMachineIds = (newIds: string[]) => {
    applySessionMachineIds(newIds);
  };

  const handleLogTSC = async (seconds: number) => {
    if (!currentSession || activeMachineIds.length === 0) return;
    // The stopwatch logs into the machine being performed: the Today cell of
    // the focused row (first incomplete machine unless the trainer tapped one).
    const targetId = gridFocusMachineId;
    if (!targetId) return;
    if (seconds > 0) {
      handleGridLiveChange(targetId, {
        isTSC: true,
        seconds: Math.round(seconds),
        reps: 0,
      });
    }
    setFocusMachineOverride(targetId);
  };
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Special listener for unassigned sessions when no client is selected
  useEffect(() => {
    if (!clientId && user) {
      const unassignedQuery = query(
        collection(db, "sessions"),
        where("isUnassigned", "==", true),
        where("status", "==", "In-Progress"),
        limit(1),
      );

      const unsubscribe = onSnapshot(
        unassignedQuery,
        (snapshot) => {
          if (!snapshot.empty) {
            const session = {
              id: snapshot.docs[0].id,
              ...snapshot.docs[0].data(),
            } as WorkoutSession;
            setCurrentSession(session);
            setSessions([session]);
          } else {
            setCurrentSession(null);
            setSessions([]);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "sessions");
        },
      );

      return () => unsubscribe();
    }
  }, [clientId, user?.uid]);

  useEffect(() => {
    if (clientId && clients) {
      const client = clients.find((c) => c.id === clientId);
      setSelectedClient(client || null);
    }
  }, [clientId, clients]);

  useEffect(() => {
    if (clientId && user) {
      // Fetch Client Machine Settings
      const settingsQuery = query(
        collection(db, "clientMachineSettings"),
        where("clientId", "==", clientId),
      );
      const unsubscribeSettings = onSnapshot(
        settingsQuery,
        (snapshot) => {
          const settingsMap: Record<string, ClientMachineSetting> = {};
          snapshot.docs.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() } as ClientMachineSetting;
            settingsMap[data.machineId] = data;
          });
          setClientMachineSettings(settingsMap);
        },
        (error) => {
          handleFirestoreError(
            error,
            OperationType.GET,
            "clientMachineSettings",
          );
        },
      );

      // Fetch Routines
      const routinesQuery = query(
        collection(db, "routines"),
        where("clientId", "==", clientId),
      );
      const unsubscribeRoutines = onSnapshot(
        routinesQuery,
        (snapshot) => {
          const routinesData = snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as Routine,
          );
          // Sort routines alphabetically so Routine A is default/first
          setRoutines(
            routinesData.sort((a, b) => a.name.localeCompare(b.name)),
          );
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "routines");
        },
      );

      // Fetch Sessions
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("clientId", "==", clientId),
      );

      const notesQuery = query(
        collection(db, "sessionNotes"),
        where("clientId", "==", clientId),
      );

      const focusQuery = query(
        collection(db, "focusRecords"),
        where("clientId", "==", clientId),
      );

      const unsubscribeSessions = onSnapshot(
        sessionsQuery,
        async (snapshot) => {
          const sessionsData = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }) as WorkoutSession)
            .sort((a, b) => {
              // Sort by the session's actual workout date (parseSessionDate),
              // the same field the History grid's date headers display —
              // NOT createdAt. createdAt is when the Firestore doc was
              // written, which for legacy-imported sessions (see
              // LegacyChartImporter.tsx) is whenever the import ran, not
              // when the workout happened. Sorting by createdAt first
              // scrambled the 5 most-recent-session columns into import
              // order instead of chronological order (e.g. "Jun 1, Jun 11,
              // Mar 16, Feb 26, Jun 8"). Falls back to startTime only when
              // a session has no date at all.
              const timeA =
                parseSessionDate(a.date) ||
                (a.startTime ? new Date(a.startTime).getTime() : 0);
              const timeB =
                parseSessionDate(b.date) ||
                (b.startTime ? new Date(b.startTime).getTime() : 0);
              return timeB - timeA;
            });
          setSessions(sessionsData);

          // Auto-select In-Progress session if it exists
          const inProgress = sessionsData.find(
            (s) => s.status === "In-Progress",
          );
          if (inProgress) {
            setCurrentSession(inProgress);
            setShowRoutinePicker(false);
            setIsPreSessionMode(false);
          } else {
            // A session created a moment ago may not be in this snapshot yet, so
            // hold onto it briefly. Bounded on purpose: the previous version kept
            // *any* in-progress session forever, so one that had been completed or
            // deleted elsewhere stayed pinned and blocked starting a new one.
            const pending = justStartedSessionRef.current;
            const stillSettling =
              pending !== null &&
              pending.clientId === clientId &&
              Date.now() - pending.at < JUST_STARTED_GRACE_MS;

            if (!stillSettling) {
              justStartedSessionRef.current = null;
              // Set outside a state updater — updaters must stay pure, and React
              // invokes them twice under StrictMode.
              setCurrentSession(null);
              setIsPreSessionMode(true);
            }
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "sessions");
        },
      );

      const unsubscribeNotes = onSnapshot(
        notesQuery,
        (snapshot) => {
          const notesData = snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as SessionNote,
          );
          setSessionNotes(notesData);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "sessionNotes");
        },
      );

      const unsubscribeFocus = onSnapshot(
        focusQuery,
        (snapshot) => {
          const focusData = snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as FocusRecord,
          );
          setFocusRecords(focusData);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "focusRecords");
        },
      );

      return () => {
        unsubscribeSettings();
        unsubscribeRoutines();
        unsubscribeSessions();
        unsubscribeNotes();
        unsubscribeFocus();
      };
    }
  }, [clientId, user?.uid, clients]);

  useEffect(() => {
    const allSessionIds = new Set<string>();
    sessions.forEach((s) => {
      if (s.id) allSessionIds.add(s.id);
    });
    if (currentSession?.id) {
      allSessionIds.add(currentSession.id);
    }

    const sessionIds = Array.from(allSessionIds).filter(Boolean).slice(0, 30);
    if (sessionIds.length > 0) {
      const logsQuery = query(
        collection(db, "exerciseLogs"),
        where("sessionId", "in", sessionIds),
      );
      const unsubscribeLogs = onSnapshot(
        logsQuery,
        (snapshot) => {
          const logsMap: Record<string, ExerciseLog> = {};
          snapshot.docs.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() } as ExerciseLog;
            const key = `${data.sessionId}_${data.machineId}${data.side ? "_" + data.side : ""}`;
            logsMap[key] = data;
          });
          setLogs(logsMap);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, "exerciseLogs");
        },
      );
      return () => unsubscribeLogs();
    }
  }, [
    sessions
      .map((s) => s.id)
      .sort()
      .join(",") + `_${currentSession?.id || ""}`,
  ]);

  // Routine Alternation Logic & Historical Lifts Fetching
  useEffect(() => {
    if (clientId && !currentSession && isPreSessionMode) {
      const determineAndFetch = async () => {
        const completed = sessions.filter((s) => s.status === "Completed");
        const lastSess = completed[0];

        // Find Routine A and B specifically
        const routineA = routines.find((r) => r.name === "Routine A");
        const routineB = routines.find((r) => r.name === "Routine B");
        const isRoutineBActive = selectedClient?.isRoutineBActive || false;

        let target: Routine | null = null;

        // Sequence Selection Logic
        if (routines.length === 0) {
          // New Client: Default to Routine A Setup
          target = { name: "Routine A", machineIds: [], clientId } as Routine;
        } else if (routineA && routineB && isRoutineBActive) {
          // Strict Alternation Logic
          const lastRoutine = routines.find(
            (r) => r.id === lastSess?.routineId,
          );
          if (lastRoutine?.name === "Routine A") {
            target = routineB;
          } else {
            target = routineA;
          }
        } else {
          // Fallback to Routine A or whatever exists
          target = routineA || routines[0];
        }

        setTargetRoutine(target);
      };
      determineAndFetch();
    }
  }, [
    clientId,
    routines,
    currentSession,
    isPreSessionMode,
    sessions,
    selectedClient?.isRoutineBActive,
  ]);

  /**
   * Load this session's machine list — ONCE.
   *
   * This effect used to depend on [currentSession, routines, machines] and
   * call setActiveMachineIds(routine.machineIds) on every run, which made it
   * the cause of the reported bug: entering a weight writes lastHeartbeatAt to
   * the session document, the snapshot fires, `currentSession` arrives as a
   * new object reference, this effect re-runs, and the machine the trainer
   * added thirty seconds ago disappears. The same fired on any `machines` or
   * `routines` snapshot, so a reorder could evaporate for no visible reason at
   * all. It looked like the routine "reverting"; it was this line.
   *
   * A session's machine list belongs to the session, so it is read from the
   * session document and seeded exactly once per session id. Older sessions
   * have no sessionMachineIds and fall back to the routine, which is also
   * where a session started before this change gets its list from.
   */
  const seededMachinesForSession = useRef<string | null>(null);

  useEffect(() => {
    const sessionId = currentSession?.id ?? null;
    if (!sessionId) {
      seededMachinesForSession.current = null;
      return;
    }
    if (seededMachinesForSession.current === sessionId) return;

    const recorded = currentSession?.sessionMachineIds;
    if (recorded && recorded.length > 0) {
      seededMachinesForSession.current = sessionId;
      setActiveMachineIds(recorded);
      return;
    }

    const routine = routines.find((r) => r.id === currentSession?.routineId);
    if (routine) {
      seededMachinesForSession.current = sessionId;
      setActiveMachineIds(routine.machineIds);
    } else if (!currentSession?.routineId && machines.length > 0) {
      // A Free session: no routine to read, so the floor is the list.
      seededMachinesForSession.current = sessionId;
      setActiveMachineIds(machines.map((m) => m.id!));
    }
    // A routineId we have not loaded yet: leave the latch unset and try again
    // on the next snapshot rather than seeding from an empty list.
  }, [currentSession, routines, machines]);

  /* REMOVED (Sep 2026): updateRoutineNote and moveMachine.

     Both wrote straight to the client's routine document — machineNotes and
     machineIds respectively — from inside the live session screen, and
     neither was called from anywhere. Unreachable, so nothing changes by
     deleting them; but a function named moveMachine that permanently
     reorders a client's prescribed routine, sitting in the session
     component, is the precise mistake the session-scope rule exists to
     prevent, and it was one wiring-up away from happening. Reordering
     mid-session goes through handleSaveSessionMachineIds, which is local
     state; routine notes are edited on the client profile. */

  const startNewSession = async (
    routineType: "A" | "B" | "Free",
    sessionType: SessionType = "Standard",
    customMachines?: string[],
    adjustmentNote?: string,
    /* `permanentSave` used to sit here, and writing it out is the only
       reason it is worth mentioning: it let a caller rewrite the client's
       saved routine as a side effect of starting a session. No caller ever
       passed true — the briefing hardcoded false and the consultation path
       omitted it — so the branch was dead, and dead is exactly how a rule
       stops being enforced by structure and starts being enforced by
       everyone remembering. Permanent routine changes are made on the client
       profile. (Sep 2026) */
    preSessionCheckIn?: PreSessionCheckIn,
  ) => {
    if (!clientId) return;
    const nextNum = (selectedClient?.sessionCount || 0) + 1;

    // Auto-populate trainer and date
    const trainerInitials =
      authTrainer?.initials || trainers[0]?.initials || "??";
    const trainerName = authTrainer ? authTrainer.fullName : "";
    const trainerId = authTrainer?.id || "";
    const date = new Date().toISOString().split("T")[0];

    try {
      let routineId: string | undefined = undefined;

      if (routineType !== "Free") {
        const routineName = `Routine ${routineType}`;
        let routine = routines.find((r) => r.name === routineName);

        if (!routine) {
          // Create the routine if it doesn't exist
          const newRoutineRef = await addDoc(collection(db, "routines"), {
            clientId,
            name: routineName,
            machineIds: customMachines || [],
            createdAt: serverTimestamp(),
            studioId: selectedClient?.homeStudioId || "",
          });
          routineId = newRoutineRef.id;

          if (routineType === "B") {
            await updateDoc(doc(db, "clients", clientId), {
              isRoutineBActive: true,
            });
          }
        } else {
          routineId = routine.id;
        }
      }

      // 1. Create the session
      // STATISTICAL ROUTING & CROSS-TRAIN DETECTION
      // The session should log where it physically happened (the currently active studio)
      // but if the client belongs elsewhere, mark it as a cross-train event.
      const currentStudioId =
        contextActiveStudioId || authTrainer?.primaryHomeStudioId || null;

      // Explicit fetch/find of client's home studio to verify cross-train status
      const targetClient = clients.find((c) => c.id === clientId);
      const clientHomeStudioId = targetClient?.homeStudioId || null;

      // Cross-Train Logic: If client's home studio != current location, flag it.
      const isCrossTrain =
        clientHomeStudioId !== null &&
        currentStudioId !== null &&
        clientHomeStudioId !== currentStudioId;

      const cleanFirestorePayload = (obj: any): any => {
        if (obj === null || obj === undefined) return null;
        if (Array.isArray(obj)) return obj.map(cleanFirestorePayload);
        if (typeof obj !== "object") return obj;
        if (
          typeof obj.toDate === "function" ||
          obj.constructor?.name === "FieldValue" ||
          obj instanceof Date
        )
          return obj;

        const cleaned: Record<string, any> = {};
        Object.entries(obj).forEach(([k, v]) => {
          if (v !== undefined) {
            cleaned[k] = cleanFirestorePayload(v);
          }
        });
        return cleaned;
      };

      /* What this session intends to run. Recorded on the document from the
         first moment so that the session, not the routine, is the thing the
         screen reads back — see WorkoutSession.sessionMachineIds. */
      const plannedMachineIds: string[] =
        customMachines && customMachines.length > 0
          ? customMachines
          : (routineId ? routines.find((r) => r.id === routineId) : null)?.machineIds ?? [];

      const sessionData: any = cleanFirestorePayload({
        clientId,
        mindbodyClientId:
          selectedClient?.mindbodyClientId ||
          selectedClient?.mindbodyId ||
          null,
        clientName: selectedClient
          ? `${selectedClient.firstName} ${selectedClient.lastName}`.trim()
          : "",
        homeStudioId: clientHomeStudioId || "",
        routineId: routineId || null,
        hostedAtStudioId: currentStudioId || "",
        clientHomeStudioId: clientHomeStudioId || "",
        sessionType: sessionType || "Standard",
        sessionNumber: nextNum,
        date,
        isCrossTrain: Boolean(isCrossTrain),
        trainerInitials: trainerInitials || "??",
        trainerName: trainerName || "",
        trainerId: trainerId || "",
        startedByTrainerId: trainerId || "",
        lastHeartbeatAt: serverTimestamp(),
        status: "In-Progress",
        sessionMachineIds: plannedMachineIds,
        // Timer bookkeeping lives on the document so elapsed time survives a
        // refresh, a navigation, or moving to another device.
        pausedAt: null,
        totalPausedMs: 0,
        // Client clock fallback: serverTimestamp() reads as null in the local
        // snapshot until the server confirms, which left the timer frozen at
        // 00:00 for that round trip.
        clientStartTime: new Date().toISOString(),
        startTime: serverTimestamp(),
        createdAt: serverTimestamp(),
        ...(preSessionCheckIn ? { preSessionCheckIn } : {}),
      });

      const docRef = await addDoc(collection(db, "sessions"), sessionData);

      // Protects this session from being cleared by a snapshot that predates it.
      justStartedSessionRef.current = {
        id: docRef.id,
        clientId,
        at: Date.now(),
      };

      const clientUpdateData: any = {};
      if (routineType === "B" && !selectedClient?.isRoutineBActive) {
        clientUpdateData.isRoutineBActive = true;
      }
      if (nextNum === 1 && !selectedClient?.firstSessionDate) {
        clientUpdateData.firstSessionDate = serverTimestamp();
      }
      if (Object.keys(clientUpdateData).length > 0) {
        await updateDoc(doc(db, "clients", clientId), clientUpdateData).catch(
          console.error,
        );
      }

      if (adjustmentNote && authTrainer) {
        await addDoc(collection(db, "sessionNotes"), {
          sessionId: docRef.id,
          clientId,
          trainerId: authTrainer.id || "",
          // Threw when a trainer record had neither initials nor a full name.
          // It only runs if a pre-session note was written, which is why the
          // crash looked intermittent.
          trainerInitials:
            authTrainer.initials ||
            (authTrainer.fullName || "").substring(0, 2).toUpperCase() ||
            "??",
          date: new Date().toLocaleDateString(),
          content: `[Protocol Adjustment]: ${adjustmentNote}`,
          createdAt: serverTimestamp(),
          studioId: selectedClient?.homeStudioId || "",
        });
      }

      // 2. Fetch last logs to pre-fill weights
      const machineLastLogs: Record<string, Partial<ExerciseLog>> = {};

      if (selectedClient && selectedClient.currentMachineMetrics) {
        Object.entries(selectedClient.currentMachineMetrics).forEach(
          ([mId, metricVal]) => {
            const metric = metricVal as any;
            // For simplicity, we just seed it directly mapping back to ExerciseLog properties
            machineLastLogs[mId] = {
              weight: metric.weight,
              reps: metric.reps,
              seconds: metric.seconds,
              isStaticHold: metric.isStaticHold,
              isTSC: metric.isTSC,
              machineId: mId,
              repQuality: 2, // default
            };
          },
        );
      }

      // Also fallback to clientMachineSettings if machine is not yet in currentMachineMetrics
      if (clientMachineSettings) {
        Object.entries(clientMachineSettings).forEach(
          ([mId, settingObjVal]) => {
            const settingObj = settingObjVal as any;
            if (!machineLastLogs[mId] && settingObj) {
              const w = settingObj.currentWeight ?? settingObj.startingWeight;
              if (w !== undefined && w !== null && String(w).trim() !== "") {
                machineLastLogs[mId] = {
                  weight: String(w),
                  machineId: mId,
                  repQuality: 2,
                };
              }
            }
          },
        );
      }

      // The trainer's prescribed weight wins over the raw last-performed
      // metric. sync-utils rewrites currentWeight to whatever was actually
      // performed when a session is saved, so this is "same as last session"
      // by default and a manual prescription whenever a trainer set one on the
      // Journey grid or the Equipment tab. Nothing progresses automatically.
      if (clientMachineSettings) {
        Object.entries(clientMachineSettings).forEach(
          ([mId, settingObjVal]) => {
            const prescribed = (settingObjVal as any)?.currentWeight;
            if (
              prescribed === undefined ||
              prescribed === null ||
              String(prescribed).trim() === ""
            ) {
              return;
            }
            if (machineLastLogs[mId]) {
              machineLastLogs[mId] = {
                ...machineLastLogs[mId],
                weight: String(prescribed),
              };
            }
          },
        );
      }

      // 3. Auto-populate logs for the machines this session will run.
      //    (Shadows the component-level state of the same name on purpose —
      //     this is the local list for seeding logs, computed above.)
      const activeMachineIds = plannedMachineIds;

      if (activeMachineIds && activeMachineIds.length > 0) {
        const currentSettings = clientMachineSettings;

        const createLogPayload = (
          prevLog: Partial<ExerciseLog> | undefined,
          mId: string,
          side?: "Left" | "Right",
          defaultWeight?: number | null,
        ) => {
          const payload: any = {
            sessionId: docRef.id,
            clientId,
            homeStudioId: clientHomeStudioId || "",
            clientHomeStudioId: clientHomeStudioId || "",
            studioId: currentStudioId || clientHomeStudioId || "",
            machineId: mId,
            machineSettings:
              currentSettings[mId]?.settings || prevLog?.machineSettings || {},
            createdAt: serverTimestamp(),
          };
          if (side) payload.side = side;
          if (prevLog) {
            if (prevLog.weight) payload.weight = String(prevLog.weight);

            // Intentionally not auto-filling reps, seconds, or repQuality per user request

            if (prevLog.isStaticHold !== undefined)
              payload.isStaticHold = Boolean(prevLog.isStaticHold);
            if (prevLog.isTSC !== undefined)
              payload.isTSC = Boolean(prevLog.isTSC);
          } else if (defaultWeight) {
            payload.weight = String(defaultWeight);
          }
          return cleanFirestorePayload(payload);
        };

        for (const mId of activeMachineIds) {
          const mac = machines.find((m) => m.id === mId);
          // `mac?.name` guarded the machine but not the field: a machine
          // document without a name threw here, after the session had already
          // been created, leaving an In-Progress session with no logs.
          const isTorsoMac = (mac?.name || "")
            .toLowerCase()
            .includes("torso rotation");

          let defaultWeight: number | null = null;
          if (!machineLastLogs[mId] && selectedClient && mac && mac.name) {
            const gender =
              selectedClient.gender === "Female" ? "Female" : "Male";
            const { calculateStartingWeight } =
              await import("../lib/consultation-utils");
            const calculatedWeight = calculateStartingWeight(
              mac.name,
              gender,
              selectedClient.age || 45,
              "Novice",
            );
            defaultWeight = calculatedWeight > 0 ? calculatedWeight : null;
          }

          if (isTorsoMac) {
            const prefilledLeft =
              machineLastLogs[`${mId}_Left`] || machineLastLogs[mId];
            const prefilledRight =
              machineLastLogs[`${mId}_Right`] || machineLastLogs[mId];

            // Create Left set
            if (prefilledLeft || defaultWeight) {
              await addDoc(
                collection(db, "exerciseLogs"),
                createLogPayload(prefilledLeft, mId, "Left", defaultWeight),
              );
            }
            // Create Right set
            if (prefilledRight || defaultWeight) {
              await addDoc(
                collection(db, "exerciseLogs"),
                createLogPayload(prefilledRight, mId, "Right", defaultWeight),
              );
            }
          } else {
            const prefilledLog = machineLastLogs[mId];
            if (prefilledLog || defaultWeight) {
              await addDoc(
                collection(db, "exerciseLogs"),
                createLogPayload(prefilledLog, mId, undefined, defaultWeight),
              );
            }
          }
        }
      }

      const newSession = {
        id: docRef.id,
        clientId,
        routineId: routineId || null,
        sessionType,
        sessionNumber: nextNum,
        date,
        clientHomeStudioId: clientHomeStudioId || currentStudioId || "",
        hostedAtStudioId: currentStudioId || "",
        isCrossTrain,
        trainerInitials,
        trainerName,
        trainerId,
        status: "In-Progress",
        startTime: new Date(),
      };

      lastMachineLoggedAt.current = Date.now();
      setCurrentSession(newSession as WorkoutSession);
      setSessions((prev) => [
        newSession as WorkoutSession,
        ...prev.filter((s) => s.id !== newSession.id),
      ]);
      setShowRoutinePicker(false);
      setIsPreSessionMode(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "sessions");
    }
  };

  const assignSessionToClient = async (targetClientId: string) => {
    const sessionToAssign = pendingAssignSession || currentSession;
    if (!sessionToAssign?.id) return;
    try {
      // 1. Update session
      await updateDoc(doc(db, "sessions", sessionToAssign.id), {
        clientId: targetClientId,
        isUnassigned: false,
        status: "Completed",
        endTime: serverTimestamp(),
      });

      // 2. Update all logs
      const logsQ = query(
        collection(db, "exerciseLogs"),
        where("sessionId", "==", sessionToAssign.id),
      );
      const snap = await getDocs(logsQ);
      for (const d of snap.docs) {
        await updateDoc(doc(db, "exerciseLogs", d.id), {
          clientId: targetClientId,
        });
      }

      // Update local state if it was the current session
      if (currentSession?.id === sessionToAssign.id) {
        setCurrentSession(null);
      }

      setSelectedClientId(targetClientId);
      setShowAssignDialog(false);
      setPendingAssignSession(null);
      setView("profile"); // Take them to profile to see the work
    } catch (error) {
      console.error("Error assigning session:", error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      // Delete associated logs first
      const logsQ = query(
        collection(db, "exerciseLogs"),
        where("sessionId", "==", sessionId),
      );
      const logsSnap = await getDocs(logsQ);
      for (const logDoc of logsSnap.docs) {
        await deleteDoc(logDoc.ref);
      }
      // Delete associated notes
      const notesQ = query(
        collection(db, "sessionNotes"),
        where("sessionId", "==", sessionId),
      );
      const notesSnap = await getDocs(notesQ);
      for (const noteDoc of notesSnap.docs) {
        await deleteDoc(noteDoc.ref);
      }
      // Delete session
      await deleteDoc(doc(db, "sessions", sessionId));

      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        setLogs({});
        setSelectedClientId(null);
        setView("clients");
      }
      setShowEndConfirmation(false);
      setShowCancelConfirmation(false);
      setPendingAssignSession(null);
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  const handleEndSessionPress = () => {
    // Last line of defence. Logs are only written to Firestore at completion, so
    // this is the final chance to catch a set that was begun but never given a
    // count — it would be stored looking complete and score zero volume.
    //
    // Scope matters: `logs` is keyed across every session loaded for this client
    // (see the exerciseLogs snapshot — up to 30 sessions), so validating it whole
    // flags zero-count sets from PAST workouts. Those cannot be fixed from here —
    // the entry dialog writes `${currentSession.id}_${machineId}` — so the guard
    // would block finishing forever. Only today's sets are this session's problem.
    const currentSessionLogs: Record<string, ExerciseLog> = {};
    Object.entries(logs as Record<string, ExerciseLog>).forEach(
      ([key, log]) => {
        if (log && log.sessionId === currentSession?.id) {
          currentSessionLogs[key] = log;
        }
      },
    );
    const incomplete = findIncompleteLogs(currentSessionLogs);
    if (incomplete.length > 0) {
      const names = incomplete
        .map(
          (i) =>
            machines.find((m) => m.id === i.machineId)?.name || i.machineId,
        )
        .filter(Boolean);
      const unique = Array.from(new Set(names));
      // The list can mix both kinds of offender; naming only the first one's
      // unit sends the trainer looking for the wrong field.
      const reasons = new Set(incomplete.map((i) => i.reason));
      const missing =
        reasons.size > 1
          ? "a rep count or a duration"
          : incomplete[0].reason === "missing-seconds"
            ? "a duration"
            : "reps";
      toastError(
        `Add ${missing} for ${unique.join(", ")} before finishing. Sets without a count are recorded as zero.`,
      );
      setEditingWeightMachineId(incomplete[0].machineId);
      // Sided machines keep a log per side — open the dialog on the side that
      // was actually flagged, or it edits a different (complete) set.
      setEditingWeightSide(incomplete[0].side);
      setIsStaticHoldOverride(incomplete[0].reason === "missing-seconds");
      return;
    }

    if (currentSession?.id && !currentSession.endTime) {
      const now = new Date();
      updateDoc(doc(db, "sessions", currentSession.id), {
        endTime: serverTimestamp(),
      }).catch(console.error);
      setCurrentSession((prev) => (prev ? { ...prev, endTime: now } : prev));
    }
    setIsPaused(true);
    setShowEndConfirmation(true);
  };

  const finalizeEndSession = async (postData?: {
    clientFeel: string;
    noteContent: string;
    notePriority: "High" | "Medium" | "Low";
  }) => {
    if (!currentSession?.id) return;

    setIsSyncing(true);
    try {
      const sessionLogs = Object.values(logs).filter(
        (l: any) => l.sessionId === currentSession.id,
      );

      await completeWorkoutSession(
        db,
        currentSession,
        selectedClient,
        sessionLogs,
        postData,
        currentSessionNotes,
        authTrainer,
        clientMachineSettings,
        user.uid,
      );

      setCurrentSession(null);
      setCurrentSessionNotes("");
      setShowEndConfirmation(false);
      setIsPostSessionMode(false);
      setSelectedClientId(null);
      setView("clients");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "sessions");
    } finally {
      setIsSyncing(false);
    }
  };

  const [selectedSessionType, setSelectedSessionType] =
    useState<SessionType>("Standard");
  const [editingWeightSide, setEditingWeightSide] = useState<
    "Left" | "Right" | undefined
  >(undefined);

  const updateLog = (
    sessionId: string,
    machineId: string,
    field: keyof ExerciseLog,
    value: any,
    side?: "Left" | "Right",
  ) => {
    updateLogMultiple(sessionId, machineId, { [field]: value }, side);
  };

  /**
   * Setting a quality is what marks a set as done, so it must not be possible
   * before a count exists. Tapping a quality dot on an empty row used to create
   * a log with a weight and a quality but no reps or seconds — which reads as
   * complete on screen and scores zero in the session rollup.
   */
  const setQualityWithGuard = (
    sessionId: string,
    machineId: string,
    quality: number,
    side?: "Left" | "Right",
  ) => {
    const key = `${sessionId}_${machineId}${side ? "_" + side : ""}`;
    const log = logs[key];

    if (!hasRequiredCount(log)) {
      const needsSeconds = Boolean(log?.isStaticHold || log?.isTSC);
      toastError(
        needsSeconds
          ? "Enter the hold duration before setting a quality."
          : "Enter reps before setting a quality.",
      );
      // Open the entry dialog so the count can be filled in straight away.
      setIsStaticHoldOverride(needsSeconds);
      setEditingWeightMachineId(machineId);
      return;
    }

    updateLog(sessionId, machineId, "repQuality", quality, side);
  };

  const updateLogMultiple = (
    sessionId: string,
    machineId: string,
    updates: Partial<ExerciseLog>,
    side?: "Left" | "Right",
  ) => {
    const key = `${sessionId}_${machineId}${side ? "_" + side : ""}`;
    const currentSettings = clientMachineSettings[machineId]?.settings || {};

    // Soft Lock Heartbeat: Update session activity timestamp
    if (currentSession?.id === sessionId) {
      updateDoc(doc(db, "sessions", sessionId), {
        lastHeartbeatAt: serverTimestamp(),
      }).catch(console.error);
    }

    setLogs((prev) => {
      const existing = prev[key];
      const updatedLog: ExerciseLog = existing
        ? { ...existing, ...updates, machineSettings: currentSettings }
        : ({
            id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, // Temporary ID for local state
            sessionId,
            clientId,
            machineId,
            ...(side ? { side } : {}),
            ...updates,
            machineSettings: currentSettings,
            createdAt: Timestamp.now(),
          } as any);

      return { ...prev, [key]: updatedLog };
    });
  };

  const toggleMachine = async (machineId: string) => {
    if (currentSession) return; // Disable during active session

    const newActiveIds = activeMachineIds.includes(machineId)
      ? activeMachineIds.filter((id) => id !== machineId)
      : [...activeMachineIds, machineId];

    setActiveMachineIds(newActiveIds);
  };

  const cancelActiveSession = async () => {
    if (!currentSession) {
      setSelectedClientId(null);
      setView("clients");
      return;
    }
    setShowCancelConfirmation(true);
  };

  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const confirmScrapSession = async () => {
    setIsDeletingSession(true);
    try {
      if (currentSession?.id) {
        await deleteSession(currentSession.id);
      } else {
        setCurrentSession(null);
        setLogs({});
        setSelectedClientId(null);
        setView("clients");
        setShowCancelConfirmation(false);
      }
    } finally {
      setIsDeletingSession(false);
    }
  };

  const getSuggestedWeight = (machine: Machine, client: Client) => {
    // Basic safety baseline: 20% of body weight as safe start if no history exists
    if (client.weight) {
      const bw = parseFloat(client.weight);
      if (!isNaN(bw)) {
        return Math.round(bw * 0.2).toString();
      }
    }

    return "0";
  };

  /* ------------------------------------------------------------------ *
   * JOURNEY GRID (Active Session)
   *
   * The session log is the shared Journey Grid with a live Today column.
   * Nothing about persistence changes: every input still goes through
   * updateLogMultiple / setQualityWithGuard into the local `logs` map, and
   * finalizeEndSession writes that map exactly as before. Torso Rotation
   * keeps its Left/Right logs — the Today cell shows two outcome rows.
   * ------------------------------------------------------------------ */
  const isSidesMachine = (m: Machine) =>
    (m.name || "").toLowerCase().includes("torso rotation");

  /** Past sessions, oldest → newest. Capped at the 30 the logs listener covers. */
  const gridHistory = useMemo(
    () =>
      toJourneySessions(
        sessions
          .filter((s) => (currentSession ? s.id !== currentSession.id : true))
          .slice(0, 30),
      ),
    [sessions, currentSession],
  );

  const [gridVisible, setGridVisible] = useState(6);
  const gridVisibleHistory = useMemo(
    () => gridHistory.slice(Math.max(0, gridHistory.length - gridVisible)),
    [gridHistory, gridVisible],
  );

  const gridRows = useMemo(() => {
    const ordered = [...machines].sort(
      (a, b) =>
        resolveMachineOrder(
          a.id,
          a.order,
          a.id ? studioMachineSettingsById[a.id]?.order : undefined,
        ) -
        resolveMachineOrder(
          b.id,
          b.order,
          b.id ? studioMachineSettingsById[b.id]?.order : undefined,
        ),
    );
    const historyLogs = (Object.values(logs) as ExerciseLog[]).filter(
      (l) => !currentSession || l.sessionId !== currentSession.id,
    );
    const starred = new Set(
      ordered.filter((m) => isBig5Machine(m.name)).map((m) => m.id!),
    );
    const orderIndex = new Map<string, number>(
      gridHistory.map((s, i) => [s.id, i] as const),
    );
    return toJourneyRows(ordered, historyLogs, clientMachineSettings, starred).map(
      (row) => {
        const machine = ordered.find((m) => m.id === row.machine.id);
        if (!machine) return row;
        const setting = clientMachineSettings[machine.id!];
        const entries = orderMachineSettings(
          setting?.settings || {},
          machine.standardSettings || {},
          machine.settingOptions || [],
        );
        // "Last weight performed" — the newest set on record.
        let lastWeight: number | undefined;
        let lastIdx = -1;
        for (const set of Object.values(row.sets)) {
          const i = orderIndex.get(set.sessionId) ?? -1;
          if (i > lastIdx) {
            lastIdx = i;
            lastWeight = set.weight;
          }
        }
        const notes = setting?.machineNotes || [];
        return {
          ...row,
          prescribedWeight:
            setting?.currentWeight ?? lastWeight ?? setting?.startingWeight,
          machine: {
            ...row.machine,
            settings: entries.length
              ? Object.fromEntries(entries.map(([k, v]) => [k, v]))
              : undefined,
            // orderMachineSettings returns [shortKey, value, fullName]; the
            // full name used to be dropped here, which left the rail with
            // unexplained letters and nothing for a screen reader to say.
            settingLabels: entries.length
              ? Object.fromEntries(entries.map(([k, , full]) => [k, full]))
              : undefined,
            alert: notes.some((n) => n.isImportant),
            noteCount: notes.length,
            sides: isSidesMachine(machine),
          },
        };
      },
    );
  }, [
    machines,
    logs,
    clientMachineSettings,
    studioMachineSettingsById,
    currentSession,
    gridHistory,
  ]);

  const gridSections = useMemo<GridSection[]>(() => {
    const byId = new Map(gridRows.map((r) => [r.machine.id, r] as const));
    const routineRows = activeMachineIds
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof gridRows;
    const inRoutine = new Set(activeMachineIds);
    const others = gridRows.filter((r) => !inRoutine.has(r.machine.id));
    return [
      { id: "routine", label: "Today's routine", rows: routineRows, numbered: true },
      {
        id: "others",
        label: "Not in today's routine",
        rows: others,
        collapsed: !showAllMachines,
        onToggle: () => setShowAllMachines(!showAllMachines),
        inactive: true,
      },
    ];
  }, [gridRows, activeMachineIds, showAllMachines]);

  const toNum = (v: unknown): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };

  /** Today's values, read straight out of the local `logs` map. */
  const gridLiveValues = useMemo(() => {
    const out: Record<string, LiveSet> = {};
    const sid = currentSession?.id;
    if (!sid) return out;
    for (const row of gridRows) {
      const id = row.machine.id;
      if (row.machine.sides) {
        const L = logs[`${sid}_${id}_Left`];
        const R = logs[`${sid}_${id}_Right`];
        if (!L && !R) continue;
        out[id] = {
          weight: toNum(L?.weight ?? R?.weight),
          reps: toNum(L?.reps),
          seconds: toNum(L?.seconds),
          isTSC: !!(L?.isTSC || L?.isStaticHold || R?.isTSC || R?.isStaticHold),
          quality: (L?.repQuality as RepQuality | undefined) ?? null,
          repsR: toNum(R?.reps),
          secondsR: toNum(R?.seconds),
          qualityR: (R?.repQuality as RepQuality | undefined) ?? null,
        };
      } else {
        const log = logs[`${sid}_${id}`];
        if (!log) continue;
        out[id] = {
          weight: toNum(log.weight),
          reps: toNum(log.reps),
          seconds: toNum(log.seconds),
          isTSC: !!(log.isTSC || log.isStaticHold),
          quality: (log.repQuality as RepQuality | undefined) ?? null,
        };
      }
    }
    return out;
  }, [logs, gridRows, currentSession?.id]);

  /**
   * Where the trainer is working.
   *
   * This is a SEED, not a live driver, and the difference is the whole point.
   *
   * It used to be the fallback whenever no machine had been tapped, which made
   * focus move on its own: entering reps auto-fills the quality mark, that
   * completes the row, this memo recomputes, and the Now bar jumps to the next
   * machine — while the trainer is still deciding whether the set they just
   * watched was a max effort or one that broke down. The screen moved on
   * mid-judgement, and the quality mark it had already filled in for them was
   * the default one.
   *
   * So focus is seeded once when a session opens (from the first incomplete
   * machine, so resuming a part-logged session lands in the right place) and
   * afterwards moves only when the trainer says so — the Next button, a tap on
   * a Today cell, or logging a TSC.
   */
  const firstIncompleteMachineId = useMemo(() => {
    if (!currentSession?.id) return null;
    for (const id of activeMachineIds) {
      const v = gridLiveValues[id];
      const done = !!v && !!(v.isTSC ? v.seconds : v.reps) && !!v.quality;
      if (!done) return id;
    }
    return activeMachineIds[0] ?? null;
  }, [activeMachineIds, gridLiveValues, currentSession?.id]);
  const [focusMachineOverride, setFocusMachineOverride] = useState<string | null>(null);
  const seededFocusForSession = useRef<string | null>(null);

  useEffect(() => {
    const sessionId = currentSession?.id ?? null;
    if (!sessionId) {
      seededFocusForSession.current = null;
      setFocusMachineOverride(null);
      return;
    }
    // Once per session, and only after the routine has loaded — seeding from
    // an empty list would pin focus to nothing and never correct itself.
    if (seededFocusForSession.current === sessionId) return;
    if (activeMachineIds.length === 0) return;
    seededFocusForSession.current = sessionId;
    setFocusMachineOverride(firstIncompleteMachineId ?? activeMachineIds[0]);
  }, [currentSession?.id, activeMachineIds, firstIncompleteMachineId]);

  /**
   * The fallback survives for exactly one case now: the focused machine being
   * dropped from the session. Anything else and the override holds, which is
   * what keeps the screen still while a set is being judged.
   */
  const gridFocusMachineId =
    focusMachineOverride && activeMachineIds.includes(focusMachineOverride)
      ? focusMachineOverride
      : firstIncompleteMachineId;

  /* Arriving at a machine starts its clock. Focus only moves on a deliberate
     act now — Next, a tap on a Today cell, a logged TSC — so this is a real
     signal about where the trainer is standing, which it was not while focus
     advanced by itself. */
  useEffect(() => {
    if (gridFocusMachineId) markMachineStarted(gridFocusMachineId);
  }, [gridFocusMachineId, markMachineStarted]);

  /* --- what the Now bar reads. All derived from state that already
     existed for the grid; the bar adds no source of truth of its own. --- */
  const gridFocusRow = useMemo(
    () => (gridFocusMachineId ? gridRows.find((r) => r.machine.id === gridFocusMachineId) : undefined),
    [gridRows, gridFocusMachineId],
  );
  const gridFocusOrder = useMemo(() => {
    const i = gridFocusMachineId ? activeMachineIds.indexOf(gridFocusMachineId) : -1;
    return i >= 0 ? i + 1 : undefined;
  }, [activeMachineIds, gridFocusMachineId]);
  const gridNextRow = useMemo(() => {
    const i = gridFocusMachineId ? activeMachineIds.indexOf(gridFocusMachineId) : -1;
    const nextId = activeMachineIds[i + 1];
    return nextId ? gridRows.find((r) => r.machine.id === nextId) : undefined;
  }, [activeMachineIds, gridFocusMachineId, gridRows]);
  const gridDoneCount = useMemo(
    () =>
      activeMachineIds.filter((id) => {
        const v = gridLiveValues[id];
        return !!v && (v.isTSC ? v.seconds != null : v.reps != null);
      }).length,
    [activeMachineIds, gridLiveValues],
  );

  /** Grid → logs. Mirrors what the old entry dialog wrote, field by field. */
  const handleGridLiveChange = (machineId: string, patch: Partial<LiveSet>) => {
    /* A trainer can log a machine without ever focusing it — tapping straight
       into its cell in the grid. First touch counts as arrival. */
    markMachineStarted(machineId);
    const sessionId = currentSession?.id;
    if (!sessionId) return;
    const row = gridRows.find((r) => r.machine.id === machineId);
    const sides = !!row?.machine.sides;
    const current = gridLiveValues[machineId];
    const shownWeight = current?.weight ?? row?.prescribedWeight ?? null;
    const str = (v: number | null | undefined) =>
      v === null || v === undefined ? "" : String(v);
    // A set logged without ever touching the weight keeps the weight that
    // was on screen (the prescription) — the old dialog did the same.
    const withWeight = (
      u: Partial<ExerciseLog>,
      side?: "Left" | "Right",
    ): Partial<ExerciseLog> => {
      const existing = logs[`${sessionId}_${machineId}${side ? "_" + side : ""}`];
      if ((!existing || !existing.weight) && shownWeight !== null && u.weight === undefined) {
        return { ...u, weight: String(shownWeight) };
      }
      return u;
    };
    const sideL = sides ? "Left" : undefined;

    if (patch.weight !== undefined) {
      updateLogMultiple(sessionId, machineId, { weight: str(patch.weight) }, sideL);
      if (sides) updateLogMultiple(sessionId, machineId, { weight: str(patch.weight) }, "Right");
    }
    if (patch.isTSC !== undefined) {
      const u = { isTSC: patch.isTSC, isStaticHold: patch.isTSC };
      updateLogMultiple(sessionId, machineId, withWeight(u, sideL), sideL);
      if (sides) updateLogMultiple(sessionId, machineId, withWeight(u, "Right"), "Right");
    }
    if (patch.reps !== undefined)
      updateLogMultiple(sessionId, machineId, withWeight({ reps: str(patch.reps) }, sideL), sideL);
    if (patch.seconds !== undefined)
      updateLogMultiple(sessionId, machineId, withWeight({ seconds: str(patch.seconds) }, sideL), sideL);
    if (patch.repsR !== undefined)
      updateLogMultiple(sessionId, machineId, withWeight({ reps: str(patch.repsR) }, "Right"), "Right");
    if (patch.secondsR !== undefined)
      updateLogMultiple(sessionId, machineId, withWeight({ seconds: str(patch.secondsR) }, "Right"), "Right");
    // "Done" stopped being a button: recording an effort completes the set,
    // and the two remaining buttons flag the sets that were not ordinary.
    // updateLog directly rather than setQualityWithGuard — that guard reads
    // `logs` from state, which has not yet seen the reps being written in
    // this same handler, so it would fire its "enter reps first" toast.
    const recorded = (v: number | null | undefined) =>
      v !== undefined && v !== null && Number(v) > 0;
    if (
      patch.quality === undefined &&
      (recorded(patch.reps) || recorded(patch.seconds)) &&
      !current?.quality
    ) {
      updateLog(sessionId, machineId, "repQuality", 2, sideL);
    }
    if (
      patch.qualityR === undefined &&
      (recorded(patch.repsR) || recorded(patch.secondsR)) &&
      !current?.qualityR
    ) {
      updateLog(sessionId, machineId, "repQuality", 2, "Right");
    }
    if (patch.quality !== undefined && patch.quality !== null)
      setQualityWithGuard(sessionId, machineId, patch.quality, sideL);
    if (patch.qualityR !== undefined && patch.qualityR !== null)
      setQualityWithGuard(sessionId, machineId, patch.qualityR, "Right");
  };

  const gridLive: LiveColumn | undefined = currentSession?.id
    ? {
        session: {
          id: currentSession.id,
          sessionNumber: currentSession.sessionNumber || sessions.length,
          date: toIsoDate(currentSession.date || new Date().toISOString().slice(0, 10)),
          trainerInitials: (
            currentSession.trainerInitials ||
            authTrainer?.initials ||
            ""
          ).toUpperCase(),
        },
        routineMachineIds: activeMachineIds,
        values: gridLiveValues,
        onChange: handleGridLiveChange,
        /* Straight in. The "+" only appears on a machine that is not in
           today's routine, so the tap is already unambiguous — and a trainer
           who has spare time and wants a bicep curl should not have to
           confirm that they meant it. Removing it is the reverse of a
           decision made when this was built ("prompts before adding it,
           rather than toggling it in silently"); silence is the point. */
        onAddMachine: (id: string) => {
          if (activeMachineIds.includes(id)) return;
          applySessionMachineIds([...activeMachineIds, id]);
        },
        focusMachineId: gridFocusMachineId,
        onFocusMachine: setFocusMachineOverride,
        weightStep: 2,
        reorder: isReorderMode,
        onMoveMachine: (id: string, direction: -1 | 1) => {
          const at = activeMachineIds.indexOf(id);
          const to = at + direction;
          if (at === -1 || to < 0 || to >= activeMachineIds.length) return;
          const next = [...activeMachineIds];
          [next[at], next[to]] = [next[to], next[at]];
          applySessionMachineIds(next);
        },
        onRemoveMachine: (id: string) =>
          applySessionMachineIds(activeMachineIds.filter((m) => m !== id)),
      }
    : undefined;

  if (!selectedClient && !currentSession) {
    return null; // The app routing will ensure this is never reached by redirecting to ClientDirectoryView instead
  }

  if (clientId && isPreSessionMode && selectedClient && !currentSession) {
    const completedSessionsCount = sessions.filter(
      (s) => s.status === "Completed",
    ).length;
    const totalSessionsCount = sessions.length;
    const hasRoutines = routines.length > 0;

    const shouldShowWizard =
      selectedClient.requiresConsultation === true &&
      selectedClient.consultationCompleted === false;

    if (shouldShowWizard) {
      return (
        <ConsultationSetupWizard
          clientName={selectedClient.firstName}
          onComplete={async (setupData) => {
            // setupData.routine is [{name: 'Leg Press', ...}]
            const machineNames = setupData.routine.map((r: any) => r.name);
            const customMachineIds = machineNames
              .map((name: string) => {
                const m = machines.find(
                  (mac) => mac.name === name || mac.fullName === name,
                );
                return m?.id;
              })
              .filter(Boolean) as string[];

            // Optional: update client with gender/age setup
            await updateDoc(doc(db, "clients", selectedClient.id!), {
              gender: setupData.gender || selectedClient.gender,
              consultationCompleted: true,
              requiresConsultation: false,
              updatedAt: serverTimestamp(),
            }).catch((e) => console.error(e));

            if (setupData.routine && setupData.routine.length > 0) {
              const machineNames = setupData.routine.map((r: any) => r.name);
              const customMachineIds = machines
                .filter((m) => machineNames.includes(m.name))
                .map((m) => m.id as string);
              startNewSession(
                "A",
                undefined,
                customMachineIds,
                "Consultation Baseline Protocol Generated",
              );
            } else {
              // If skipped, we don't start a session, just let the state refresh
              // which will cause the wizard to disappear because consultationCompleted is now true
              setIsPreSessionMode(true); // Land them on the BriefingScreen instead of hiding it
            }
          }}
          onCancel={() => {
            setIsPreSessionMode(false);
            setView("profile");
          }}
        />
      );
    }

    return (
      <BriefingScreen
        authTrainer={authTrainer}
        client={selectedClient}
        targetRoutine={targetRoutine}
        lastSession={
          sessions.filter((s) => s.status === "Completed")[0] || null
        }
        onStart={(routineType, customMachines, note, checkIn) =>
          startNewSession(
            routineType,
            undefined,
            customMachines,
            note,
            checkIn,
          )
        }
        onClose={() => {
          setIsPreSessionMode(false);
          setView("profile");
        }}
        machines={machines}
        routines={routines}
        trainerFocuses={trainerFocuses.filter((f) => f.clientId === clientId)}
        focusRecords={focusRecords}
        sessionNotes={sessionNotes}
        trainers={trainers}
        logs={
          Object.values(logs).filter(
            (l: any) => !l.clientId || l.clientId === clientId,
          ) as any
        }
        isIntroSession={isIntroSession}
        rightControls={rightControls}
        trainerDropdown={trainerDropdown}
        onStudioClick={onStudioClick}
      />
    );
  }

  if (isPostSessionMode && currentSession && selectedClient) {
    return (
      <VictoryHUDScreen
        client={selectedClient}
        session={currentSession}
        logs={
          Object.values(logs).filter(
            (l: any) => l.sessionId === currentSession.id,
          ) as any
        }
        allLogs={
          Object.values(logs).filter(
            (l: any) => l.clientId === selectedClient.id,
          ) as any
        }
        schedules={schedules}
        authTrainer={authTrainer}
        onFinalize={finalizeEndSession}
        isSyncing={isSyncing}
        machines={machines}
        rightControls={rightControls}
        trainerDropdown={trainerDropdown}
        onStudioClick={onStudioClick}
      />
    );
  }

  const clientNameDisplay = selectedClient
    ? `${selectedClient.firstName} ${selectedClient.lastName}`
    : "Open Session";
  const lastSession = sessions.length > 0 ? sessions[0] : null;
  const previousSession = sessions.length > 1 ? sessions[1] : null;

  // Suggested routine from targetRoutine state
  const getSuggestedType = (rt: Routine | null): "A" | "B" | "Free" =>
    routineLetterOf(rt) ?? (rt ? "Free" : "A");

  const suggestedRoutineType = (() => {
    if (routines.length === 0) return "A";
    if (routines.length === 1)
      return (
        matchesRoutineLetter(routines[0], "B") ? "B" : "A"
      ) as RoutineType;

    // If we have both, alternate based on last session
    if (!lastSession || !lastSession.routineId) return "A";

    const lastR = routines.find((r) => r.id === lastSession.routineId);
    if (!lastR) return "A";

    return matchesRoutineLetter(lastR, "A") ? "B" : "A";
  })();
  const isRoutineBActive = selectedClient?.isRoutineBActive || false;

  // Check for rest days (3 days recommended)
  const daysSinceLastSession = lastSession?.date
    ? Math.floor(
        (new Date().getTime() - parseSessionDate(lastSession.date)) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const needsRest = daysSinceLastSession !== null && daysSinceLastSession < 3;

  const hasActiveHeader = !!(selectedClient || currentSession);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "h-full min-h-0 flex flex-col overflow-hidden relative",
      )}
    >
      {isIntroSession && (
        <div className="bg-orange-500 dark:bg-orange-600 p-3 rounded-2xl flex items-center justify-center gap-3 shadow-lg shadow-orange-500/20 border border-white/20 animate-pulse mt-2 mx-4 relative z-40">
          <Sparkles className="w-5 h-5 text-slate-900 dark:text-white" />
          <span className="text-slate-900 dark:text-white font-black uppercase italic tracking-[0.15em] text-xs">
            NEW CLIENT INTRODUCTORY SESSION: CONVERSATIONAL BASELINE
          </span>
          <Sparkles className="w-5 h-5 text-slate-900 dark:text-white" />
        </div>
      )}
      {/* Zone 1 — session bar. In flow, one row, 48px. It used to be a
          position:fixed two-row overlay (min-h-25) that the grid had to pad
          around; the shell is a real flex column now, so it just sits here.
          Focus moved out of here entirely — it filters the routine list, so
          it belongs on the grid rail beside the list it filters. */}
      {(selectedClient || currentSession) && (
        <div className="flex-none flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 h-12 bg-white dark:bg-bg-dark border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white truncate max-w-30 sm:max-w-none">
            {selectedClient
              ? `${selectedClient.firstName} ${selectedClient.lastName}`
              : currentSession?.isUnassigned
                ? "Unassigned Tracking"
                : "Initializing..."}
          </h3>
          <span className="hidden sm:inline font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
            #{currentSession?.sessionNumber || sessions.length} ·{" "}
            {authTrainer?.initials || currentSession?.trainerInitials || "??"}
          </span>
          {currentSession && (
            <div className="flex items-center shrink-0">
              <ActiveSessionTimer
                startTime={currentSession.startTime}
                fallbackStartTime={(currentSession as any).clientStartTime}
                pausedAt={(currentSession as any).pausedAt}
                totalPausedMs={(currentSession as any).totalPausedMs}
                onTogglePause={toggleSessionPause}
                isMobile
              />
            </div>
          )}

          <span className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsShowingSessionNotes(true)}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-surface-1 h-8 px-2 sm:px-2.5 rounded-lg text-[11px] flex items-center gap-1 shrink-0"
          >
            <MessageSquare className="w-3 h-3 text-cta shrink-0 fill-current" />
            <span className="hidden sm:inline">Notes</span>
          </Button>
          {/* The 90-day assessment, reachable without ending the session.
              A trainer has about ninety seconds while a client works the
              lumbar machine, and what they want to do with it is record the
              one thing the client just said. Before this, the assessment
              lived on a full-page wizard reached from the profile -- so the
              thing they had just heard got remembered until after the
              session, which means it got lost. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsShowingAssessment(true)}
            title="Add to the 90-day assessment without leaving the session"
            className="border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-surface-1 h-8 px-2 sm:px-2.5 rounded-lg text-[11px] flex items-center gap-1 shrink-0"
          >
            <HeartPulse className="w-3 h-3 text-cta shrink-0" />
            <span className="hidden sm:inline">Assessment</span>
          </Button>
          {/* Routine editing used to sit here, between Notes and Discard.
              It acts on the machine list, so it moved down to the grid rail
              that sits directly on top of that list -- and moving it also
              buys a gap between the buttons a trainer presses all session
              and Discard, which destroys the session. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCancelConfirmation(true)}
            title="Discard active session without saving"
            className="border-red-500/30 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 px-2 sm:px-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider shrink-0"
          >
            <Trash2 className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline ml-1">Discard</span>
          </Button>
          <Button
            onClick={handleEndSessionPress}
            className="bg-cta hover:opacity-90 text-white font-bold shadow-sm h-8 px-3 sm:px-4 rounded-lg text-[11px] uppercase tracking-wider cursor-pointer whitespace-nowrap shrink-0"
          >
            Finish
          </Button>
        </div>
      )}
      {/* Machine Performance Entry Dialog */}
      {editingWeightMachineId &&
        currentSession &&
        (() => {
          const theMachine = machines.find(
            (m) => m.id === editingWeightMachineId,
          )!;
          const isTorso = theMachine.name
            .toLowerCase()
            .includes("torso rotation");

          let sideToUse = editingWeightSide;
          if (isTorso) sideToUse = undefined; // We handle both sides in the dialog

          const keyL = `${currentSession.id}_${editingWeightMachineId}_Left`;
          const keyR = `${currentSession.id}_${editingWeightMachineId}_Right`;
          const keyDef = `${currentSession.id}_${editingWeightMachineId}${sideToUse ? "_" + sideToUse : ""}`;

          const logL = isTorso ? logs[keyL] : logs[keyDef];
          const logR = isTorso ? logs[keyR] : undefined;

          let currentWeight =
            (isTorso ? logL?.weight || logR?.weight : logL?.weight) || "0";
          const clientId = currentSession.clientId || selectedClient?.id;
          if (currentWeight === "0" && clientId) {
            currentWeight = getLatestTargetWeight(
              clientId,
              editingWeightMachineId,
              sessions,
              Object.values(logs),
              sideToUse,
            );
          }

          const currentRepsLeft = logL
            ? logL?.isStaticHold
              ? logL.seconds || ""
              : logL?.reps || ""
            : "";
          const currentRepsRightStr = logR
            ? logR?.isStaticHold
              ? logR.seconds || ""
              : logR?.reps || ""
            : "";

          return (
            <PerformanceEntryDialog
              machine={theMachine}
              side={sideToUse}
              isTorsoFull={isTorso}
              machineSettings={clientMachineSettings[editingWeightMachineId]}
              currentWeight={currentWeight}
              currentReps={currentRepsLeft}
              currentRepsRight={isTorso ? currentRepsRightStr : undefined}
              currentQuality={logL?.repQuality || 0}
              pastMachineLogs={sessions
                .filter((s) =>
                  currentSession ? s.id !== currentSession.id : true,
                )
                .map((s) => {
                  const log =
                    logs[
                      `${s.id}_${editingWeightMachineId}${isTorso ? "_Left" : sideToUse ? "_" + sideToUse : ""}`
                    ] || logs[`${s.id}_${editingWeightMachineId}`];
                  return log && log.weight ? { log, session: s } : null;
                })
                .filter(
                  (x): x is { log: ExerciseLog; session: WorkoutSession } =>
                    Boolean(x),
                )
                .slice(0, 3)}
              isStaticHold={isStaticHoldOverride || logL?.isStaticHold}
              onClose={() => {
                setEditingWeightMachineId(null);
                setEditingWeightSide(undefined);
                setIsStaticHoldOverride(false);
              }}
              onSave={async (
                weight,
                repsOrSeconds,
                quality,
                isHold,
                side,
                repsRightStr,
              ) => {
                /**
                 * `isStaticHold` and `isTSC` both mean "this set is timed", and
                 * hasRequiredCount treats them as an OR. Writing only one of
                 * them leaves the other stuck true, so a set switched back to
                 * reps is still judged as a hold — with `seconds` just zeroed —
                 * and can never satisfy the finish guard. They move together.
                 *
                 * One combined write per side rather than five sequential ones:
                 * updateLogMultiple also stamps a session heartbeat, so the old
                 * version fired five Firestore writes per set saved (ten for a
                 * torso rotation).
                 */
                const performanceFields = (
                  hold: boolean,
                  count: string,
                ): Partial<ExerciseLog> => ({
                  weight,
                  // The dialog's `quality` is a plain number (0 = none yet);
                  // the stored field is 1 | 2 | 3. canSave already refuses 0,
                  // so anything reaching here is a real rating.
                  repQuality: quality as ExerciseLog["repQuality"],
                  isStaticHold: hold,
                  isTSC: hold,
                  seconds: hold ? count : "0",
                  reps: hold ? "0" : count,
                });

                if (isTorso) {
                  // Both sides share the weight and quality, each keeps its own count.
                  updateLogMultiple(
                    currentSession.id!,
                    editingWeightMachineId,
                    performanceFields(isHold, repsOrSeconds),
                    "Left",
                  );
                  updateLogMultiple(
                    currentSession.id!,
                    editingWeightMachineId,
                    performanceFields(isHold, repsRightStr || "0"),
                    "Right",
                  );
                } else {
                  updateLogMultiple(
                    currentSession.id!,
                    editingWeightMachineId,
                    performanceFields(isHold, repsOrSeconds),
                    side,
                  );
                }

                setEditingWeightMachineId(null);
                setEditingWeightSide(undefined);
                // Must be cleared here too, not only in onClose: a stale `true`
                // opens the next machine's dialog in hold mode, storing its rep
                // count as `seconds` with reps "0".
                setIsStaticHoldOverride(false);
              }}
            />
          );
        })()}

      {/* First-time setup prompt — opens over the Entry HUD when the trainer
          reaches a machine this client has never performed. Same SettingsCard
          and SetupGuide the Equipment tab uses, so the ghosting rules and the
          journal sync behave identically; only `origin` differs. */}
      {setupPromptMachineId && (
        <SetupPromptDialog
          open
          machine={machines.find((m) => m.id === setupPromptMachineId) || null}
          clientId={clientId || ""}
          clientSettings={clientMachineSettings}
          author={
            authTrainer
              ? {
                  id: authTrainer.id || "unknown",
                  fullName:
                    authTrainer.fullName || authTrainer.initials || "Unknown",
                  initials: authTrainer.initials,
                }
              : null
          }
          sessionId={currentSession?.id || null}
          onClose={() => setSetupPromptMachineId(null)}
          onError={toastError}
        />
      )}

      {/* THE MACHINE SHEET. One target, one sheet.

          It replaces two modals that used to sit here: a "Machine Settings"
          dialog opened by tapping a machine, and a "Machine Notes" dialog
          opened by a small separate icon on the same row. Two near-identical
          targets, and a trainer standing at a machine with a client waiting
          had to know which one held the thing they wanted. A wrong guess
          cost two taps, so the honest outcome was that notes did not get
          written.

          Both entry points now land in the same place -- note the two
          handlers below the grid both call setSheetMachineId -- and the
          sheet stacks what it holds in the order the floor needs it:
          high-importance notes first, then the dials, then the note
          composer, then reference.

          It also fixes where the writes go. The old dialog wrote a third
          copy of every settings change into a `machineSettingChanges`
          collection that nothing in this app has ever read back, and its
          "reason for change" therefore went nowhere a trainer could find
          it. The sheet calls features/equipment/mutations.ts -- the same
          functions the Equipment tab calls -- so a change made mid-session
          is in clientMachineSettings, in the machine's settingHistory WITH
          its reason, and in the client's Journal, and is already showing on
          their Equipment tab before the trainer walks back to the desk. */}
      <MachineSheet
        open={!!sheetMachineId}
        machine={machines.find((m) => m.id === sheetMachineId) || null}
        client={selectedClient}
        clientId={clientId || ""}
        clientSettings={clientMachineSettings}
        author={
          authTrainer
            ? {
                id: authTrainer.id || "unknown",
                fullName: authTrainer.fullName || authTrainer.initials || "Unknown",
                initials: authTrainer.initials,
              }
            : null
        }
        sessionId={currentSession?.id || null}
        onClose={() => setSheetMachineId(null)}
        onError={toastError}
      />

      {/* Exercise History Dialog */}
      {historyMachineId && clientId && (
        <ExerciseHistoryDialog
          clientId={clientId}
          machine={machines.find((m) => m.id === historyMachineId)!}
          onClose={() => setHistoryMachineId(null)}
          user={user}
        />
      )}

      {/* Machine Details Modal */}
      {showClientPicker && (
        <ClientSelectionDialog
          clients={clients}
          onSelect={(id) => {
            setSelectedClientId(id);
            setShowClientPicker(false);
            setView("workouts");
          }}
          onClose={() => setShowClientPicker(false)}
        />
      )}

      {/* Client Selection Dialog (for assigning) */}
      <ClientSelectionDialog
        open={showAssignDialog}
        clients={clients}
        onSelect={assignSessionToClient}
        onClose={() => {
          setShowAssignDialog(false);
          setCurrentSession(null);
        }}
        title="Assign Completed Session"
        description="Choose which client's profile should receive this session's data."
      />

      {/* End Session Confirmation Dialog */}
      <Dialog open={showEndConfirmation} onOpenChange={setShowEndConfirmation}>
        <DialogContent className="sm:max-w-100 rounded-[32px] p-0 overflow-hidden border-none shadow-2xl dark:shadow-none">
          <div className="bg-primary p-8 text-slate-900 dark:text-white space-y-3">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-2">
              <AlertCircle className="w-6 h-6 text-slate-900 dark:text-white" />
            </div>
            <h3 className="text-2xl font-black italic uppercase tracking-tight">
              End Session?
            </h3>
            <p className="text-primary-foreground/90 font-medium text-sm leading-relaxed">
              Are you sure you want to conclude this{" "}
              {currentSession?.sessionType.toLowerCase()} workout session?
            </p>
          </div>

          <div className="p-6 space-y-4">
            {currentSession?.isUnassigned ? (
              <div className="space-y-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground px-1 mb-2">
                  Unassigned Session Actions
                </p>
                <Button
                  className="w-full h-14 rounded-2xl font-black italic uppercase tracking-widest text-sm shadow-lg shadow-primary/20"
                  onClick={() => {
                    setShowEndConfirmation(false);
                    setShowAssignDialog(true);
                  }}
                >
                  <Users className="w-4 h-4 mr-3" /> Assign to Client
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-14 rounded-2xl font-black italic uppercase tracking-widest text-sm border-2"
                  onClick={() => {
                    setShowEndConfirmation(false);
                    setPendingAssignSession(currentSession);
                    onStartNewClientOnboarding("");
                    // We don't necessarily need to setView('clients') if the modal is global,
                    // but it helps if user cancels modal to be in a logical place.
                    setView("clients");
                  }}
                >
                  <PlusCircle className="w-4 h-4 mr-3" /> Create New Client
                </Button>
                <div className="py-2 flex items-center gap-4">
                  <div className="h-px bg-border flex-1" />
                  <span className="text-[11px] font-black text-muted-foreground uppercase tracking-widest">
                    Danger Zone
                  </span>
                  <div className="h-px bg-border flex-1" />
                </div>
                <Button
                  variant="ghost"
                  className="w-full h-14 rounded-2xl font-black italic uppercase tracking-widest text-sm text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => deleteSession(currentSession!.id!)}
                >
                  <Trash2 className="w-4 h-4 mr-3" /> Delete Session
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Session Notes
                  </label>
                  <Textarea
                    value={currentSessionNotes}
                    onChange={(e) => setCurrentSessionNotes(e.target.value)}
                    placeholder="Log general observations here..."
                    className="min-h-25 border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-bg-dark resize-none text-slate-800 dark:text-slate-200 placeholder:text-slate-500 focus-visible:ring-orange-500 focus-visible:border-orange-500"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs border-2 dark:border-slate-800 dark:hover:bg-surface-1"
                    onClick={() => setShowEndConfirmation(false)}
                  >
                    Keep Training
                  </Button>
                  <Button
                    className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-primary/20 bg-red-600 text-white hover:bg-red-700"
                    onClick={() => {
                      if (currentSession) {
                        setCurrentSession({
                          ...currentSession,
                          endTime: new Date(),
                        });
                      }
                      setShowEndConfirmation(false);
                      setIsPostSessionMode(true);
                    }}
                    disabled={isSyncing}
                  >
                    Confirm End
                  </Button>
                </div>
                <div className="pt-4 flex justify-center border-t border-slate-100 dark:border-slate-800 mt-2">
                  <button
                    onClick={() => {
                      setShowEndConfirmation(false);
                      setShowCancelConfirmation(true);
                    }}
                    className="text-xs font-bold uppercase tracking-widest text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors py-3 px-6 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Abort Session (No Record)
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Scrap Session Confirmation Dialog */}
      <Dialog
        open={showCancelConfirmation}
        onOpenChange={(v) => !isDeletingSession && setShowCancelConfirmation(v)}
      >
        <DialogContent className="sm:max-w-100 rounded-[32px] p-0 overflow-hidden border-none shadow-2xl dark:shadow-none">
          <div className="bg-white dark:bg-bg-dark p-8 text-slate-900 dark:text-white space-y-3">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-2 transition-all ${isDeletingSession ? "bg-red-500/20 text-red-500 animate-pulse" : "bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]"}`}
            >
              {isDeletingSession ? (
                <Loader2 className="w-6 h-6 animate-spin text-red-500" />
              ) : (
                <Trash2 className="w-6 h-6" />
              )}
            </div>
            <h3 className="text-2xl font-black italic uppercase tracking-tight">
              {isDeletingSession
                ? "Deleting Session..."
                : "Scrap Active Session?"}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm leading-relaxed">
              {isDeletingSession
                ? "Scrapping all logged sets, timers, and notes. Cleaning database records..."
                : "Are you sure you want to cancel this session? All data logged so far will be scrapped and will not be recorded in the database."}
            </p>
          </div>

          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white dark:bg-bg-dark border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="outline"
              disabled={isDeletingSession}
              className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-surface-2 disabled:opacity-50"
              onClick={() => setShowCancelConfirmation(false)}
            >
              Resume Session
            </Button>
            <Button
              disabled={isDeletingSession}
              className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs bg-red-600 text-white shadow-lg shadow-red-200 dark:shadow-none hover:bg-red-700 disabled:opacity-80 flex items-center justify-center gap-2"
              onClick={confirmScrapSession}
            >
              {isDeletingSession ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                "Scrap Session"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Zones 2 + 3 — the grid rail, then the grid. The rail carries the
          controls that act on the list directly below it: Focus (Routine /
          All), Older, and the legend. The legend lays out inline when there
          is width for it and collapses to a Key popover when there is not,
          so it costs no permanent vertical space either way. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* The rail used to open with the word ROUTINE, then a bare
            "6 of 21", then a segmented control whose left half also said
            Routine -- three pieces of chrome for one idea. It is one
            sentence now: Show [All | Routine], and a chip saying how many of
            how many. Then the control that edits that list. */}
        <div className="jg-rail">
          <span className="jg-rail__label">Show:</span>
          <div className="jg-seg2" role="radiogroup" aria-label="Which machines to list">
            <button
              type="button"
              role="radio"
              aria-checked={showAllMachines}
              className={`jg-seg2__btn ${showAllMachines ? "is-on" : ""}`}
              onClick={() => setShowAllMachines(true)}
            >
              All
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!showAllMachines}
              className={`jg-seg2__btn ${!showAllMachines ? "is-on" : ""}`}
              onClick={() => setShowAllMachines(false)}
            >
              Routine
            </button>
          </div>
          <span
            className="jg-rail__count"
            aria-label={`${activeMachineIds.length} machines in today's routine, of ${gridRows.length} on file`}
          >
            <b>{activeMachineIds.length}</b> <i>of</i> {gridRows.length}
          </span>
          <button
            type="button"
            className={`jg-rail__edit ${isReorderMode ? "is-on" : ""}`}
            aria-pressed={isReorderMode}
            onClick={() => setIsReorderMode((o) => !o)}
          >
            <Settings2 className="w-3 h-3 shrink-0" strokeWidth={2.5} />
            {isReorderMode ? "Done" : "Reorder"}
          </button>
          <button
            type="button"
            className="jg-rail__older"
            onClick={() => setGridVisible((v) => v + 5)}
            disabled={gridVisible >= gridHistory.length}
          >
            <ChevronLeft className="w-3 h-3" strokeWidth={2.5} />
            Older
          </button>
          <span className="jg-rail__sp" />
          <div className="jg-rail__legend">
            <QualityLegend />
          </div>
          <div className="jg-keywrap">
            <button
              type="button"
              className={`jg-key ${isLegendOpen ? "is-on" : ""}`}
              aria-expanded={isLegendOpen}
              onClick={() => setIsLegendOpen((o) => !o)}
            >
              Key
            </button>
            {isLegendOpen && (
              <div className="jg-keypop" role="dialog" aria-label="Rep quality key">
                <QualityLegend />
              </div>
            )}
          </div>
        </div>

        {gridLive && (
          <JourneyGrid
            sessions={gridVisibleHistory}
            historySessions={gridHistory}
            sections={gridSections}
            live={gridLive}
            /* Analytics is a review tool: "highest weight, Sep 2" is what you
               read on the client profile, not what you need while a set is
               running. Off here, it hands its 100px to the timeline. */
            showStats={false}
            onLoadOlder={() => setGridVisible((v) => v + 5)}
            canLoadOlder={gridVisible < gridHistory.length}
            /* The machine's NAME is the target -- one big one, the width of
               the rail, instead of a name that did nothing and two small
               icons beside it that did different things. The note icon
               still works; it just opens the same sheet, so a trainer who
               aims for it is never wrong. */
            onSelectMachine={(id) => setSheetMachineId(id)}
            onMachineNote={(id) => setSheetMachineId(id)}
            layout="fill"
            title="Machine"
          />
        )}
      </div>

      {/* Zone 4 — "The Now". Everything between walking up to a machine and
          logging the set, in one place that never moves. */}
      {gridLive && (
        <SessionNowBar
          row={gridFocusRow}
          orderNumber={gridFocusOrder}
          value={gridFocusMachineId ? gridLiveValues[gridFocusMachineId] : undefined}
          history={gridHistory}
          onChange={handleGridLiveChange}
          step={2}
          nextName={gridNextRow?.machine.name}
          onNext={() => gridNextRow && setFocusMachineOverride(gridNextRow.machine.id)}
          onLogTSC={handleLogTSC}
          doneCount={gridDoneCount}
          totalCount={activeMachineIds.length}
        />
      )}

      {/* THE ASSESSMENT SLIDE-OVER.

          Same component the Journal tab uses -- ClientCheckInPanel over a
          Draft check-in that persists between sessions -- so a trainer can
          answer one topic here, another next week, and finalise it when the
          90 days are up. It autosaves per edit, so there is nothing to
          submit and nothing to lose by closing it.

          Deliberately NOT the full QuickCheckInDialog: that one takes the
          whole screen and saves as Finalized, which ends the assessment. A
          session is a stream of small observations, not a sitting.

          A slide-over rather than a modal because the session has to stay
          visible behind it: the timer is running, the client is on a
          machine, and covering that up is what makes a trainer close the
          thing without writing anything. */}
      <AnimatePresence>
        {isShowingAssessment && selectedClient && (
          <div className="fixed inset-0 z-[100] flex justify-end overflow-hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsShowingAssessment(false)}
              className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
              role="dialog"
              aria-label="90-day assessment"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-5 dark:border-slate-800">
                <div className="flex flex-col">
                  <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tighter text-slate-900 dark:text-white">
                    <HeartPulse className="h-5 w-5 text-orange-500" /> Assessment
                  </h2>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Saves as you type · session keeps running
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsShowingAssessment(false)}
                  aria-label="Close assessment"
                  className="rounded-full hover:bg-white dark:hover:bg-surface-1/10"
                >
                  <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                </Button>
              </div>
              <div className="custom-scrollbar flex-1 overflow-y-auto p-5">
                <React.Suspense
                  fallback={
                    <div className="flex items-center justify-center py-16 text-xs font-bold uppercase tracking-widest text-slate-400">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading assessment…
                    </div>
                  }
                >
                  <ClientCheckInPanel
                    client={selectedClient}
                    trainer={authTrainer || null}
                    machines={machines}
                  />
                </React.Suspense>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isShowingSessionNotes && currentSession && clientId && (
          <SessionJournalSidebar
            session={currentSession}
            clientId={clientId}
            clientFirstName={selectedClient?.firstName || ""}
            studioId={selectedClient?.homeStudioId || contextActiveStudioId || ""}
            author={{
              id: authTrainer?.id || user?.uid || "unknown",
              initials: (authTrainer?.initials || "TR").toUpperCase(),
              fullName: authTrainer?.fullName || "Coach",
            }}
            machines={machines}
            defaultMachineId={gridFocusMachineId}
            onClose={() => setIsShowingSessionNotes(false)}
          />
        )}
      </AnimatePresence>

      {currentSession && activeMachineIds.length > 0 && (
        <div className="fixed bottom-0 left-2 p-1 pointer-events-none opacity-20 z-110">
          <span className="text-[11px] text-slate-800 dark:text-slate-200 font-mono tracking-widest">
            {machineTimeElapsed}s
          </span>
        </div>
      )}
    </motion.div>
  );
}
