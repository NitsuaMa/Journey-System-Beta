import React, { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  writeBatch,
  doc,
  Timestamp,
  addDoc,
  getDocs,
  limit,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Calendar as CalendarIcon,
  Save,
  CheckCircle2,
  Clock,
  AlertCircle,
  PlusCircle,
  Trash2,
  Maximize,
  Network,
  CalendarDays,
  List as ListIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WorkoutSession,
  ExerciseLog,
  Machine,
  Trainer,
  RepQuality,
  Studio,
  ClientEvent,
} from "../types";
import { cn, parseSessionDate, calculateExerciseVolume } from "../lib/utils";
import { OperationType, handleFirestoreError } from "../lib/firestore-errors";
import { deletedSessionRollup } from "../lib/client-rollups";
import { useActiveStudio } from "../ActiveStudioContext";

function getTrainerChipStyles(initials: string) {
  if (!initials) return "bg-ink-l2 text-white";
  const colors = [
    "bg-cyan text-white",
    "bg-cta text-white",
    "bg-green text-ink-l1",
    "bg-amber text-white",
    "bg-ink-l2 text-white",
  ];
  let hash = 0;
  for (let i = 0; i < initials.length; i++) {
    hash = initials.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

export function ClientHistoryCalendar({
  clientId,
  clientHomeStudioId,
  machines,
  trainers,
  user,
  allLogs = [],
  clientEvents = [],
}: {
  clientId: string;
  clientHomeStudioId?: string;
  machines: Machine[];
  trainers: Trainer[];
  user?: any;
  allLogs?: ExerciseLog[];
  clientEvents?: ClientEvent[];
}) {
  const { activeStudioId } = useActiveStudio();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [localAllLogs, setLocalAllLogs] = useState<ExerciseLog[]>([]);
  const [viewDate, setViewDate] = useState(new Date()); // For month navigation
  const [viewType, setViewType] = useState<"calendar" | "list">("calendar");
  const [selectedDaySessions, setSelectedDaySessions] = useState<
    WorkoutSession[]
  >([]);
  const [activeSessionIndex, setActiveSessionIndex] = useState(0);
  const [selectedSessionLogs, setSelectedSessionLogs] = useState<ExerciseLog[]>(
    [],
  );
  const [editedLogs, setEditedLogs] = useState<
    Record<string, Partial<ExerciseLog>>
  >({});
  const [isSaving, setIsSaving] = useState(false);

  const [isEditMode, setIsEditMode] = useState(false);
  const [editedSessionNotes, setEditedSessionNotes] = useState<string>("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [manualDate, setManualDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [manualTrainerId, setManualTrainerId] = useState("");

  const selectedSession = selectedDaySessions[activeSessionIndex] || null;

  // Fetch all sessions for calendar
  useEffect(() => {
    if (!clientId || !user) return;
    const q = query(
      collection(db, "sessions"),
      where("clientId", "==", clientId),
      orderBy("date", "desc"),
      limit(30),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSessions(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as WorkoutSession,
          ),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "sessions");
      },
    );
    return () => unsubscribe();
  }, [clientId, user?.uid]);

  // No longer fetching ALL logs here, using allLogs prop or specific session fetches

  // Fetch logs for selected session
  useEffect(() => {
    if (!selectedSession || !selectedSession.id || !user) {
      setSelectedSessionLogs([]);
      setEditedLogs({});
      setIsEditMode(false);
      setEditedSessionNotes("");
      return;
    }
    setEditedSessionNotes(selectedSession.notes || "");
    const q = query(
      collection(db, "exerciseLogs"),
      where("sessionId", "==", selectedSession.id),
      orderBy("createdAt", "asc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSelectedSessionLogs(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as ExerciseLog,
          ),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "exerciseLogs");
      },
    );
    return () => unsubscribe();
  }, [selectedSession?.id, user?.uid]);

  const daysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  };

  const sessionsOnDay = (date: Date) => {
    return sessions.filter((s) => {
      const timestamp = parseSessionDate(s.date);
      if (timestamp === 0) return false;
      const d = new Date(timestamp);
      return isSameDay(d, date);
    });
  };

  const eventsOnDay = (date: Date) => {
    return clientEvents.filter((e) => {
      if (!e.date) return false;
      const start = new Date(e.date);
      start.setHours(0, 0, 0, 0);
      const end = e.endDate ? new Date(e.endDate) : start;
      end.setHours(23, 59, 59, 999);
      return date >= start && date <= end;
    });
  };

  const handleLogEdit = (
    logId: string,
    field: keyof ExerciseLog,
    value: any,
  ) => {
    setEditedLogs((prev) => ({
      ...prev,
      [logId]: {
        ...prev[logId],
        [field]: value,
      },
    }));
  };

  const handleDeleteSession = async () => {
    if (!selectedSession) return;
    setIsDeletingSession(true);
    try {
      const batch = writeBatch(db);
      const sessionRef = doc(db, "sessions", selectedSession.id!);
      batch.delete(sessionRef);

      // delete logs
      selectedSessionLogs.forEach((log) => {
        batch.delete(doc(db, "exerciseLogs", log.id!));
      });

      // decrement client's session count if completed — and take the
      // session's Top Trainer vote and machine counts back with it.
      if (selectedSession.status === "Completed" && clientId) {
        batch.update(doc(db, "clients", clientId), {
          completedSessions: increment(-1),
          sessionCount: increment(-1),
          ...deletedSessionRollup(
            selectedSession,
            selectedSessionLogs,
            { increment, serverTimestamp },
          ),
        });
      }

      await batch.commit();

      if (selectedDaySessions.length <= 1) {
        setSelectedDaySessions([]);
        setActiveSessionIndex(0);
      } else {
        const newSessions = [...selectedDaySessions];
        newSessions.splice(activeSessionIndex, 1);
        setSelectedDaySessions(newSessions);
        setActiveSessionIndex(Math.max(0, activeSessionIndex - 1));
      }
      setShowDeleteConfirm(false);
      setIsEditMode(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, "sessions");
    } finally {
      setIsDeletingSession(false);
    }
  };

  const handleCreateManualLog = async () => {
    setIsSaving(true);
    try {
      const qs = query(
        collection(db, "sessions"),
        where("clientId", "==", clientId),
        orderBy("date", "desc"),
        limit(1),
      );
      const res = await getDocs(qs);
      let sessionNumber = 1;
      if (!res.empty) {
        sessionNumber = res.docs[0].data().sessionNumber + 1;
      }
      const trainer = trainers.find((t) => t.id === manualTrainerId);

      const newSession: WorkoutSession = {
        clientId,
        date: manualDate,
        hostedAtStudioId: activeStudioId || "unknown",
        clientHomeStudioId: clientHomeStudioId || activeStudioId || "unknown",
        isCrossTrain: !!(
          clientHomeStudioId &&
          activeStudioId &&
          clientHomeStudioId !== activeStudioId
        ),
        sessionType: "Standard",
        startTime: manualDate + "T12:00:00.000Z",
        endTime: manualDate + "T12:30:00.000Z",
        trainerInitials: trainer?.initials || "TR",
        status: "Completed",
        sessionNumber,
        notes: "Manually inputted past session.",
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, "sessions"), newSession);

      // Create empty logs for their top machines to seed
      const recentLogsQ = query(
        collection(db, "exerciseLogs"),
        where("clientId", "==", clientId),
        orderBy("date", "desc"),
        limit(15),
      );
      const recentLogsRes = await getDocs(recentLogsQ);
      const recentMachineIds = Array.from(
        new Set(recentLogsRes.docs.map((d) => d.data().machineId)),
      ).slice(0, 5);

      const batch = writeBatch(db);
      recentMachineIds.forEach((mId) => {
        const machine = machines.find((m) => m.id === mId);
        if (machine) {
          const logRef = doc(collection(db, "exerciseLogs"));
          const mockLog: ExerciseLog = {
            clientId,
            sessionId: docRef.id,
            machineId: mId,
            weight: "0",
            reps: "0",
            seconds: "0",
            machineSettings: {},
            createdAt: new Date().toISOString(),
            studioId: activeStudioId || clientHomeStudioId || "",
            homeStudioId: clientHomeStudioId || activeStudioId || "",
            clientHomeStudioId: clientHomeStudioId || activeStudioId || "",
          };
          batch.set(logRef, mockLog);
        }
      });
      await batch.commit();

      setShowManualLog(false);
      setManualTrainerId("");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "sessions");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBatchUpdate = async () => {
    if (
      Object.keys(editedLogs).length === 0 &&
      editedSessionNotes === selectedSession?.notes
    ) {
      setIsEditMode(false);
      return;
    }
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      Object.entries(editedLogs).forEach(([logId, data]) => {
        const logRef = doc(db, "exerciseLogs", logId);
        batch.update(logRef, {
          ...(data as object),
          updatedAt: Timestamp.now(),
        });
      });
      if (selectedSession && editedSessionNotes !== selectedSession.notes) {
        const sessionRef = doc(db, "sessions", selectedSession.id!);
        batch.update(sessionRef, {
          notes: editedSessionNotes,
          updatedAt: Timestamp.now(),
        });
      }
      await batch.commit();
      setEditedLogs({});
      setIsEditMode(false);

      // Update local state for immediate feedback
      setSelectedSessionLogs((prev) =>
        prev.map((log) => {
          if (editedLogs[log.id!]) {
            return { ...log, ...editedLogs[log.id!] };
          }
          return log;
        }),
      );

      if (selectedSession) {
        const newSessions = [...selectedDaySessions];
        newSessions[activeSessionIndex] = {
          ...selectedSession,
          notes: editedSessionNotes,
        };
        setSelectedDaySessions(newSessions);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "exerciseLogs");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 overflow-hidden rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-2xl p-2 sm:p-6 text-slate-800 dark:text-slate-200">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-cta/10 rounded-2xl flex items-center justify-center border border-cta/20 shadow-sm shrink-0">
            <CalendarIcon className="w-6 h-6 sm:w-7 sm:h-7 text-cta" />
          </div>
          <div>
            <div className="flex items-center gap-3 sm:gap-4">
              <h2 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter leading-none shrink-0 font-display">
                {viewType === "calendar"
                  ? viewDate instanceof Date && !isNaN(viewDate.getTime())
                    ? viewDate.toLocaleString("default", { month: "long" })
                    : "Invalid Date"
                  : "Client History"}
              </h2>
              {viewType === "calendar" && (
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePrevMonth}
                    className="text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl h-8 w-8 transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNextMonth}
                    className="text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl h-8 w-8 transition-all"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mt-1">
              {viewType === "calendar"
                ? viewDate.getFullYear()
                : `${sessions.length} Sessions Total`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* View toggle — a real segmented control, big enough to be the
              first thing a thumb finds. Brand blue = "you can act on this";
              the two labels stay visible in both states so the trainer can
              always see where they are AND where they can go. */}
          <div
            role="group"
            aria-label="History view"
            className="inline-flex h-11 sm:h-12 items-stretch p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm"
          >
            <button
              type="button"
              onClick={() => setViewType("calendar")}
              aria-pressed={viewType === "calendar"}
              className={cn(
                "inline-flex items-center gap-2 px-3.5 sm:px-5 rounded-xl text-[11px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all",
                viewType === "calendar"
                  ? "bg-[#0a548b] text-white shadow-sm dark:bg-[#4a9fd8] dark:text-slate-950"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100",
              )}
            >
              <CalendarDays className="w-4 h-4" />
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setViewType("list")}
              aria-pressed={viewType === "list"}
              className={cn(
                "inline-flex items-center gap-2 px-3.5 sm:px-5 rounded-xl text-[11px] sm:text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all",
                viewType === "list"
                  ? "bg-[#0a548b] text-white shadow-sm dark:bg-[#4a9fd8] dark:text-slate-950"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100",
              )}
            >
              <ListIcon className="w-4 h-4" />
              List
            </button>
          </div>
          <Button
            onClick={() => setShowManualLog(true)}
            variant="outline"
            className="border-[#F06C22]/50 text-[#F06C22] hover:bg-[#F06C22]/10 font-black tracking-wider uppercase text-[10px] sm:text-[11px] h-10 sm:h-11 rounded-2xl px-3 sm:px-5 bg-white dark:bg-slate-900 whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4 mr-1.5" /> Log Past Session
          </Button>
        </div>
      </div>

      {viewType === "calendar" ? (
        <>
          {/* Marker 10: same language as the Hub strip — narrow uppercase
              weekday over a black numeral, cyan for the day you are on,
              a cyan hairline ring for today, Sundays recessive. */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 shrink-0">
            {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d, i) => (
              <div key={d} className="text-center pb-1 sm:pb-2">
                <span
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.14em]",
                    i === 0
                      ? "text-slate-400 dark:text-slate-600"
                      : "text-slate-500 dark:text-slate-400",
                  )}
                >
                  {d}
                </span>
              </div>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 sm:pr-2 custom-scrollbar pb-6 flex flex-col gap-1 sm:gap-2">
            {(() => {
              const year = viewDate.getFullYear();
              const month = viewDate.getMonth();
              const firstDay = firstDayOfMonth(year, month);
              const totalDays = daysInMonth(year, month);

              const matrix: (Date | null)[] = [];
              for (let i = 0; i < firstDay; i++) matrix.push(null);
              for (let i = 1; i <= totalDays; i++)
                matrix.push(new Date(year, month, i));

              // Chunk matrix into weeks (7 days per week)
              const weeks: (Date | null)[][] = [];
              for (let i = 0; i < matrix.length; i += 7) {
                weeks.push(matrix.slice(i, i + 7));
              }

              return weeks.map((week, wIdx) => {
                // Determine if this weekly row contains the currently active/selected day, or today as fallback
                const selectedTimestamp = selectedSession
                  ? parseSessionDate(selectedSession.date)
                  : 0;
                const selectedDate =
                  selectedTimestamp > 0 ? new Date(selectedTimestamp) : null;
                const isWeekActive = week.some(
                  (date) =>
                    date &&
                    ((selectedDate && isSameDay(date, selectedDate)) ||
                      (!selectedDate && isSameDay(date, new Date()))),
                );

                return (
                  <div
                    key={`week-${wIdx}`}
                    className={cn(
                      "grid grid-cols-7 gap-1 sm:gap-2 rounded-xl transition-colors duration-200",
                      isWeekActive ? "bg-slate-100/60 dark:bg-slate-800/30" : "",
                    )}
                  >
                    {week.map((date, idx) => {
                      if (!date)
                        return (
                          <div
                            key={`empty-${wIdx}-${idx}`}
                            className="min-h-12.5 sm:min-h-21.25"
                          />
                        );

                      const daySessions = sessionsOnDay(date);
                      const dayEvents = eventsOnDay(date);
                      const timestamp = selectedSession
                        ? parseSessionDate(selectedSession.date)
                        : 0;
                      const isSelected =
                        selectedSession &&
                        timestamp > 0 &&
                        isSameDay(new Date(timestamp), date);
                      const today = isSameDay(new Date(), date);

                      return (
                        <div
                          key={`day-${idx}`}
                          onClick={() => {
                            if (daySessions.length > 0) {
                              setSelectedDaySessions(daySessions);
                              setActiveSessionIndex(0);
                            }
                          }}
                          className={cn(
                            "min-h-12.5 sm:min-h-19 p-2 sm:p-2.5 rounded-lg border transition-colors relative group flex flex-col justify-between select-none",
                            daySessions.length > 0
                              ? "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60"
                              : "cursor-default",
                            isSelected
                              ? "bg-cyan border-cyan text-slate-900 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                              : today
                                ? "bg-slate-200/70 dark:bg-slate-800/70 border-transparent ring-1 ring-cyan/50"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700",
                            date.getDay() === 0 && !isSelected && !today ? "opacity-70" : "",
                            dayEvents.some(
                              (e) =>
                                e.type === "Vacation" ||
                                e.type === "Medical" ||
                                e.type === "Snowbird",
                            )
                              ? "bg-red-50/50 border-red-100 dark:bg-red-950/20 dark:border-red-900/30"
                              : "",
                          )}
                        >
                          <span
                            className={cn(
                              "text-xs sm:text-base font-black leading-none font-sans tabular-nums absolute top-2 left-2 sm:top-2.5 sm:left-2.5 z-10",
                              isSelected
                                ? "text-slate-900"
                                : "text-slate-800 dark:text-slate-200",
                              dayEvents.some(
                                (e) =>
                                  e.type === "Vacation" ||
                                  e.type === "Medical" ||
                                  e.type === "Snowbird",
                              )
                                ? "text-red-500"
                                : "",
                            )}
                          >
                            {date.getDate()}
                          </span>

                          {daySessions.length > 0 &&
                            (() => {
                              const s = daySessions[0];
                              const isB = s.routineName
                                ?.toUpperCase()
                                .includes("B");
                              const isA = s.routineName
                                ?.toUpperCase()
                                .includes("A");
                              const letter = isB ? "B" : isA ? "A" : "•";
                              const routineBg = isB
                                ? "bg-cta text-white"
                                : isA
                                  ? "bg-cyan text-white"
                                  : "bg-slate-400 dark:bg-slate-500 text-white";

                              return (
                                <div
                                  className={cn(
                                    "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black uppercase absolute top-2.5 right-2.5 shadow-sm",
                                    routineBg,
                                  )}
                                >
                                  {letter}
                                </div>
                              );
                            })()}

                          {daySessions.length > 0 &&
                            (() => {
                              const initials =
                                daySessions[0].trainerInitials || "--";
                              return (
                                <div
                                  className={cn(
                                    "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black uppercase absolute bottom-2.5 right-2.5 shadow-sm z-10",
                                    getTrainerChipStyles(initials),
                                  )}
                                >
                                  {initials}
                                </div>
                              );
                            })()}

                          {dayEvents.length > 0 && (
                            <div className="absolute bottom-2 left-2 right-12 flex flex-col gap-1 z-10 w-fit max-w-[80%]">
                              {dayEvents.map((e) => (
                                <div
                                  key={e.id}
                                  className={cn(
                                    "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded text-white overflow-hidden text-ellipsis whitespace-nowrap",
                                    e.type === "Alert"
                                      ? "bg-amber-500"
                                      : e.type === "Medical" ||
                                          e.type === "Snowbird" ||
                                          e.type === "Vacation"
                                        ? "bg-red-500"
                                        : "bg-cyan-500",
                                  )}
                                >
                                  {e.title || e.type}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-1 sm:px-2 custom-scrollbar flex flex-col gap-5 pb-6">
          {/* The list is the calendar unrolled: the same month framing, the
              same day tile with the routine letter top-right and the trainer
              chip bottom-right, so switching views never re-teaches the eye
              where anything lives. Each row adds what a tile has no room for —
              session number, time, gap since the last visit, machines, volume. */}
          {(() => {
            const completedSessions = sessions.filter((s) => s.status === "Completed");
            // `routineName` is denormalised onto session docs by the live
            // session flow but never made it onto the type; read it loosely.
            type HistorySession = WorkoutSession & { routineName?: string };
            const groups: { key: string; label: string; year: number; items: HistorySession[] }[] = [];
            for (const s of sessions as HistorySession[]) {
              const t = parseSessionDate(s.date);
              const d = t > 0 ? new Date(t) : null;
              const key = d ? `${d.getFullYear()}-${d.getMonth()}` : "undated";
              let g = groups.find((x) => x.key === key);
              if (!g) {
                g = {
                  key,
                  label: d ? d.toLocaleString("default", { month: "long" }) : "Undated",
                  year: d ? d.getFullYear() : 0,
                  items: [],
                };
                groups.push(g);
              }
              g.items.push(s);
            }

            return groups.map((group) => (
              <section key={group.key}>
                <div className="sticky top-0 z-10 flex items-baseline gap-3 py-1.5 mb-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
                  <h3 className="text-lg sm:text-xl font-black italic uppercase tracking-tighter leading-none font-display text-slate-900 dark:text-slate-100">
                    {group.label}
                  </h3>
                  {group.year > 0 && (
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                      {group.year}
                    </span>
                  )}
                  <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {group.items.length} {group.items.length === 1 ? "session" : "sessions"}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  {group.items.map((session) => {
                    const index = sessions.indexOf(session);
                    const timestamp = parseSessionDate(session.date);
                    const sDate = timestamp > 0 ? new Date(timestamp) : null;
                    const completedIndex = completedSessions.findIndex((s) => s.id === session.id);
                    const calculatedSessionNumber =
                      completedIndex >= 0 ? completedSessions.length - completedIndex : "?";

                    // Days since the previous session — the next item in the
                    // reverse-chronological array.
                    let daysSincePrev: number | null = null;
                    if (index >= 0 && index < sessions.length - 1) {
                      const prevTimestamp = parseSessionDate(sessions[index + 1].date);
                      if (timestamp > 0 && prevTimestamp > 0) {
                        daysSincePrev = Math.round((timestamp - prevTimestamp) / (1000 * 60 * 60 * 24));
                      }
                    }

                    const isLegacy =
                      session.legacy_filemaker_id ||
                      session.trainerId === "legacy-trainer" ||
                      session.trainerInitials === "Legacy" ||
                      session.trainerInitials === "Chart";

                    const sessionLogs = (allLogs || localAllLogs).filter((l) => l.sessionId === session.id);
                    const totalVolume = Math.round(sessionLogs.reduce((acc, log) => acc + calculateExerciseVolume(log), 0));
                    const machineNames = sessionLogs
                      .map((l) => machines.find((mac) => mac.id === l.machineId)?.name || "Unknown")
                      .filter((n) => n !== "Unknown");
                    const shorthandMachines = machineNames.join(", ");

                    const upper = session.routineName?.toUpperCase() || "";
                    const isB = upper.includes("B");
                    const isA = upper.includes("A");
                    const letter = isB ? "B" : isA ? "A" : "•";
                    const routineBg = isB
                      ? "bg-cta text-white"
                      : isA
                        ? "bg-cyan text-white"
                        : "bg-slate-400 dark:bg-slate-500 text-white";
                    const initials = session.trainerInitials || "--";
                    /**
                     * `startTime` arrives as a Timestamp, a number, an ISO
                     * string or a Date depending on which write produced the
                     * session. The old code fed all four straight to
                     * `new Date()`, and the shapes it could not parse rendered
                     * the literal string "Invalid Date" down the whole list.
                     * Parse defensively and fall back to the date we already
                     * have.
                     */
                    const startMs = (() => {
                      const raw: any = session.startTime;
                      if (!raw) return 0;
                      if (typeof raw?.toMillis === "function") return raw.toMillis();
                      if (typeof raw?.seconds === "number") return raw.seconds * 1000;
                      if (raw instanceof Date) return raw.getTime();
                      const t = new Date(raw).getTime();
                      return Number.isNaN(t) ? 0 : t;
                    })();
                    const timeLabel =
                      isLegacy || startMs <= 0
                        ? null
                        : new Date(startMs).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          });

                    // Volume against the previous COMPLETED session — the
                    // column the eye runs down when it wants "is this client
                    // progressing?". Walking the raw `sessions` array instead
                    // put a cancelled or scheduled row in between, which zeroed
                    // the comparison and silently dropped the delta.
                    const prevSession =
                      completedIndex >= 0 ? completedSessions[completedIndex + 1] : undefined;
                    const prevVolume = prevSession
                      ? Math.round(
                          (allLogs || localAllLogs)
                            .filter((l) => l.sessionId === prevSession.id)
                            .reduce((acc, log) => acc + calculateExerciseVolume(log), 0),
                        )
                      : 0;
                    const volumeDelta =
                      prevVolume > 0 && totalVolume > 0
                        ? Math.round(((totalVolume - prevVolume) / prevVolume) * 100)
                        : null;

                    return (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedDaySessions([session]);
                          setActiveSessionIndex(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedDaySessions([session]);
                            setActiveSessionIndex(0);
                          }
                        }}
                        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4 p-2 sm:p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a548b] dark:focus-visible:ring-[#4a9fd8]"
                      >
                        {/* Day tile — the calendar cell, lifted into the list. */}
                        <div className="relative w-16 h-16 sm:w-18 sm:h-18 shrink-0 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-1.5 sm:p-2 flex flex-col">
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 leading-none">
                            {sDate ? sDate.toLocaleDateString("default", { weekday: "short" }) : "—"}
                          </span>
                          <span className="text-xl sm:text-2xl font-black leading-none font-sans text-slate-900 dark:text-slate-100 mt-1">
                            {sDate ? sDate.getDate() : "--"}
                          </span>
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black uppercase absolute top-1.5 right-1.5 shadow-sm",
                              routineBg,
                            )}
                            title={session.routineName ? `Routine ${session.routineName}` : "No routine recorded"}
                          >
                            {letter}
                          </div>
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black uppercase absolute bottom-1.5 right-1.5 shadow-sm",
                              getTrainerChipStyles(initials),
                            )}
                            title={`Trainer ${initials}`}
                          >
                            {initials}
                          </div>
                        </div>

                        {/* What the tile has no room for. */}
                        <div className="min-w-0 flex flex-col justify-center gap-1">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] sm:text-[11px] font-black text-[#034a84] dark:text-[#7cc0ee] uppercase tracking-wider border-[#0a548b]/25 bg-[#0a548b]/10 dark:border-[#4a9fd8]/30 dark:bg-[#4a9fd8]/10 px-2 py-0.5 rounded-lg h-auto! shrink-0"
                            >
                              S{calculatedSessionNumber}
                            </Badge>
                            <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 font-mono shrink-0">
                              {isLegacy ? "Imported" : timeLabel ?? "—"}
                            </span>
                            {daysSincePrev !== null && (
                              <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
                                · {daysSincePrev === 1 ? "1 day" : `${daysSincePrev} days`} since last
                              </span>
                            )}
                            {session.isCrossTrain && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-black uppercase tracking-wider border-[#0a548b]/30 text-[#034a84] dark:text-[#7cc0ee] dark:border-[#4a9fd8]/30 px-2 py-0.5 rounded-lg h-auto! shrink-0 inline-flex items-center gap-1"
                              >
                                <Network className="w-3 h-3" /> Cross-train
                              </Badge>
                            )}
                            {isLegacy && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-black uppercase tracking-wider border-[#F06C22]/40 text-[#bc2c00] dark:text-[#ff9455] px-2 py-0.5 rounded-lg h-auto! shrink-0"
                              >
                                Imported
                              </Badge>
                            )}
                          </div>
                          {/* Marker 11: the machine names used to run the
                              width of the row and truncate mid-word, so every
                              row looked the same and none of them was
                              readable. The COUNT is the scannable fact; the
                              names stay on the hover title for when the
                              trainer actually wants them. */}
                          <p
                            className="text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate"
                            title={shorthandMachines || undefined}
                          >
                            {machineNames.length > 0 ? (
                              <span className="text-slate-700 dark:text-slate-300">
                                {machineNames.length} machine{machineNames.length === 1 ? "" : "s"}
                              </span>
                            ) : (
                              <span className="italic text-slate-400">No machines logged</span>
                            )}
                            {machineNames.length > 0 && (
                              <span className="hidden sm:inline"> · {shorthandMachines}</span>
                            )}
                          </p>
                        </div>

                        {/* Volume — a fixed-width, right-aligned, tabular
                            column so the eye can run straight down it. */}
                        <div className="flex w-24 sm:w-28 flex-col items-end justify-center shrink-0 pr-1 sm:pr-2">
                          <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest font-sans">
                            Volume
                          </span>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base sm:text-xl font-black text-slate-900 dark:text-slate-100 font-display tabular-nums">
                              {totalVolume.toLocaleString()}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500 uppercase">lbs</span>
                          </div>
                          {volumeDelta !== null && volumeDelta !== 0 && (
                            <span
                              className={cn(
                                "text-[10px] font-black tabular-nums leading-none",
                                volumeDelta > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-slate-400 dark:text-slate-500",
                              )}
                              title={`vs ${prevVolume.toLocaleString()} lbs last session`}
                            >
                              {volumeDelta > 0 ? `+${volumeDelta}%` : `${volumeDelta}%`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ));
          })()}
        </div>
      )}

      <Dialog
        open={!!selectedSession}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDaySessions([]);
            setActiveSessionIndex(0);
            setIsEditMode(false);
            setEditedLogs({});
          }
        }}
      >
        <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[95dvh] w-full border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 p-0 overflow-hidden shadow-2xl flex flex-col text-slate-800 dark:text-slate-200">
          {selectedSession && (
            <>
              {/* Header Banner */}
              <div className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 transition-all">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-2 font-display">
                    <span className="text-cyan">
                      {(() => {
                        if (!selectedSession) return "";
                        const timestamp = parseSessionDate(
                          selectedSession.date,
                        );
                        if (timestamp > 0) {
                          return new Date(timestamp).toLocaleDateString(
                            "en-US",
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            },
                          );
                        }
                        return "Invalid Date";
                      })()}
                    </span>
                  </h2>
                  <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800"
                    >
                      TR: {selectedSession.trainerInitials || "N/A"}
                    </Badge>
                    {selectedSessionLogs.length} Units Logged
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-2 shadow-xs">
                    <span className="text-[11.5px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest font-sans">
                      Routine:
                    </span>
                    <span
                      className={cn(
                        "text-xl font-black italic uppercase leading-none font-display",
                        selectedSession.routineName?.toUpperCase().includes("B")
                          ? "text-cta"
                          : "text-cyan",
                      )}
                    >
                      {selectedSession.routineName || "Special"}
                    </span>
                  </div>
                  {isEditMode && (
                    <Button
                      variant="ghost"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-500/50 hover:text-red-500 hover:bg-red-500/10 h-10 w-10 p-0 rounded-xl transition-all shrink-0"
                      title="Delete Session"
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  )}
                  {!isEditMode && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditedSessionNotes(selectedSession.notes || "");
                        setIsEditMode(true);
                      }}
                      className="font-black uppercase tracking-widest h-10 px-6 rounded-xl border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shrink-0 text-[11px] shadow-xs"
                    >
                      Enter Edit Mode
                    </Button>
                  )}
                </div>
              </div>

              {/* Pinned Analytics Header Strip */}
              <div className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-2.5 flex items-center justify-between sm:justify-start gap-4 flex-wrap shrink-0">
                {/* Routine Chip */}
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-1.5 shadow-xs">
                  <span className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest font-sans">
                    Routine:
                  </span>
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black uppercase text-white shadow-xs font-sans",
                      selectedSession.routineName?.toUpperCase().includes("B")
                        ? "bg-cta"
                        : selectedSession.routineName
                              ?.toUpperCase()
                              .includes("A")
                          ? "bg-cyan"
                          : "bg-slate-400",
                    )}
                  >
                    {selectedSession.routineName?.toUpperCase().includes("B")
                      ? "B"
                      : selectedSession.routineName?.toUpperCase().includes("A")
                        ? "A"
                        : "•"}
                  </div>
                </div>

                {/* Trainer Chip */}
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-1.5 shadow-xs">
                  <span className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest font-sans">
                    Trainer:
                  </span>
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black uppercase shadow-xs font-sans",
                      getTrainerChipStyles(
                        selectedSession.trainerInitials || "--",
                      ),
                    )}
                  >
                    {selectedSession.trainerInitials || "--"}
                  </div>
                </div>

                {/* Session count / logs badge */}
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-1.5 shadow-xs">
                  <span className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest font-sans">
                    Units:
                  </span>
                  <span className="text-[11px] font-black uppercase text-slate-850 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-md px-1.5 py-0.5 border border-slate-200 dark:border-slate-700">
                    {selectedSessionLogs.length} Checked
                  </span>
                </div>

                {/* Total tonnage volume volume */}
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-3 py-1.5 shadow-xs sm:ml-auto">
                  <span className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest font-sans">
                    Total Volume:
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-black text-cta font-display">
                      {(() => {
                        const selectedSessionTotalVolume = Math.round(
                          selectedSessionLogs.reduce(
                            (acc, log) => acc + calculateExerciseVolume(log),
                            0,
                          ),
                        );
                        return selectedSessionTotalVolume.toLocaleString();
                      })()}
                    </span>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase font-sans">
                      lbs
                    </span>
                  </div>
                </div>
              </div>

              {/* Multi-Session Tabs if > 1 */}
              {selectedDaySessions.length > 1 && (
                <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-2 flex gap-2 shrink-0 overflow-x-auto hide-scrollbar">
                  {selectedDaySessions.map((sess, i) => {
                    const globalIdx = sessions.findIndex(
                      (s) => s.id === sess.id,
                    );
                    const sessNum =
                      globalIdx >= 0 ? sessions.length - globalIdx : "?";
                    return (
                      <button
                        key={sess.id}
                        onClick={() => {
                          setActiveSessionIndex(i);
                          setIsEditMode(false);
                        }}
                        className={cn(
                          "px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all border",
                          activeSessionIndex === i
                            ? "bg-cyan/10 border-cyan/50 text-cyan"
                            : "bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
                        )}
                      >
                        S{sessNum} -{" "}
                        {sess.legacy_filemaker_id
                          ? "Imported"
                          : sess.startTime
                            ? new Date(
                                sess.startTime?.toMillis?.() || sess.startTime,
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "No Time"}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white dark:bg-slate-900 min-h-0">
                {selectedSessionLogs.length > 0 ? (
                  <div className="max-w-7xl mx-auto space-y-6 pb-6">
                    {/* Machine Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {selectedSessionLogs.map((log) => {
                        const machine = machines.find(
                          (m) => m.id === log.machineId,
                        );
                        const isEdited = !!editedLogs[log.id!];
                        const currentData = { ...log, ...editedLogs[log.id!] };
                        const rawQuality = currentData.repQuality || 0;
                        // Tiered Fallback: Normalize 1-3, map legacy > 3 or odd values to 2 (Completed)
                        const quality =
                          rawQuality === 1 ||
                          rawQuality === 2 ||
                          rawQuality === 3
                            ? rawQuality
                            : rawQuality > 0
                              ? 2
                              : 0;

                        let displayBorder =
                          "border-slate-250 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200";
                        if (quality === 3)
                          displayBorder =
                            "border-green bg-green/10 text-slate-800 dark:text-slate-200";
                        else if (quality === 2)
                          displayBorder =
                            "border-amber bg-amber/10 text-slate-800 dark:text-slate-200";
                        else if (quality === 1)
                          displayBorder =
                            "border-cta bg-cta/10 text-slate-800 dark:text-slate-200";

                        const isCardio =
                          machine?.name.toLowerCase().includes("cardio") ||
                          log.type === "Cardio";
                        const isStaticHold = Boolean(currentData.isStaticHold);
                        const displayMetricType = isCardio
                          ? "Cardio"
                          : isStaticHold
                            ? "TSC"
                            : "Strength";

                        const wVal =
                          parseFloat(
                            String(currentData.weight || "").replace(
                              /[^0-9.]/g,
                              "",
                            ),
                          ) || 0;
                        const rVal =
                          isCardio || isStaticHold
                            ? parseFloat(
                                String(currentData.seconds || "").replace(
                                  /[^0-9.]/g,
                                  "",
                                ),
                              ) || 0
                            : parseFloat(
                                String(currentData.reps || "").replace(
                                  /[^0-9.]/g,
                                  "",
                                ),
                              ) || 0;

                        return (
                          <div
                            key={log.id}
                            className={cn(
                              "flex flex-col p-3 rounded-2xl border-2 transition-all",
                              displayBorder,
                              isEdited && isEditMode
                                ? "shadow-[0_0_15px_rgba(56,189,248,0.2)]"
                                : "",
                            )}
                          >
                            {!isEditMode ? (
                              <div className="flex flex-col h-full justify-between">
                                <div>
                                  <div className="flex justify-between items-start gap-2">
                                    <h4 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-slate-100 leading-none truncate mb-1 font-display">
                                      {machine?.name || "Unknown"}
                                    </h4>
                                    {isStaticHold && (
                                      <span className="px-1.5 py-0.5 rounded-md bg-cyan/10 text-cyan text-[11px] font-black tracking-widest uppercase">
                                        TSC
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {currentData.weight || "-"} lbs |{" "}
                                    {isCardio || isStaticHold
                                      ? currentData.seconds
                                      : currentData.reps}{" "}
                                    {isCardio || isStaticHold ? "sec" : "reps"}
                                  </p>
                                </div>
                                <div className="mt-2 text-[11px] font-black tracking-widest uppercase flex gap-1 items-center">
                                  <span className="text-slate-450 dark:text-slate-500">
                                    Quality:
                                  </span>
                                  {quality === 1 && (
                                    <span className="text-cta">Poor</span>
                                  )}
                                  {quality === 2 && (
                                    <span className="text-amber">
                                      Completed
                                    </span>
                                  )}
                                  {quality === 3 && (
                                    <span className="text-green">
                                      Max Strength
                                    </span>
                                  )}
                                  {quality === 0 && (
                                    <span className="text-slate-450 dark:text-slate-550">
                                      N/A
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-3">
                                <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-xl">
                                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 dark:text-slate-100 leading-none truncate font-display">
                                    {machine?.name || "Unknown"}
                                  </h4>
                                  {!isCardio && (
                                    <button
                                      onClick={() => {
                                        const newIsHold = !isStaticHold;
                                        handleLogEdit(
                                          log.id!,
                                          "isStaticHold",
                                          newIsHold,
                                        );
                                        if (newIsHold) {
                                          handleLogEdit(
                                            log.id!,
                                            "seconds",
                                            currentData.reps || "0",
                                          );
                                          handleLogEdit(log.id!, "reps", "0");
                                        } else {
                                          handleLogEdit(
                                            log.id!,
                                            "reps",
                                            currentData.seconds || "0",
                                          );
                                          handleLogEdit(
                                            log.id!,
                                            "seconds",
                                            "0",
                                          );
                                        }
                                      }}
                                      className={cn(
                                        "px-2 py-0.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors",
                                        isStaticHold
                                          ? "bg-cyan text-white shadow-xs"
                                          : "bg-white dark:bg-slate-900 border border-slate-350 dark:border-slate-700 text-slate-650 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800",
                                      )}
                                    >
                                      TSC
                                    </button>
                                  )}
                                  {isCardio && (
                                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tracking-widest uppercase">
                                      Cardio
                                    </span>
                                  )}
                                </div>

                                {/* Weight Stepper */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-1.5 flex items-center justify-between shrink-0">
                                  <button
                                    onClick={() =>
                                      handleLogEdit(
                                        log.id!,
                                        "weight",
                                        Math.max(0, wVal - 2).toString(),
                                      )
                                    }
                                    className="w-10 h-10 shrink-0 flex items-center justify-center text-slate-700 dark:text-slate-350 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all focus:outline-none"
                                  >
                                    <span className="text-xl font-medium leading-none mb-1">
                                      -2
                                    </span>
                                  </button>
                                  <div className="flex flex-col items-center flex-1">
                                    <input
                                      type="number"
                                      value={wVal || ""}
                                      onChange={(e) =>
                                        handleLogEdit(
                                          log.id!,
                                          "weight",
                                          (
                                            parseFloat(e.target.value) || 0
                                          ).toString(),
                                        )
                                      }
                                      className="w-16 min-w-16 bg-transparent text-center text-xl font-black text-slate-900 dark:text-white focus:outline-none p-0"
                                    />
                                    <span className="text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold leading-none mt-0.5 font-sans">
                                      Lbs
                                    </span>
                                  </div>
                                  <button
                                    onClick={() =>
                                      handleLogEdit(
                                        log.id!,
                                        "weight",
                                        (wVal + 2).toString(),
                                      )
                                    }
                                    className="w-10 h-10 shrink-0 flex items-center justify-center text-slate-700 dark:text-slate-350 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all focus:outline-none"
                                  >
                                    <span className="text-xl font-medium leading-none mb-1">
                                      +2
                                    </span>
                                  </button>
                                </div>

                                {/* Reps/Time Stepper */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-1.5 flex items-center justify-between shrink-0">
                                  <button
                                    onClick={() =>
                                      handleLogEdit(
                                        log.id!,
                                        isCardio || isStaticHold
                                          ? "seconds"
                                          : "reps",
                                        Math.max(0, rVal - 1).toString(),
                                      )
                                    }
                                    className="w-10 h-10 shrink-0 flex items-center justify-center text-slate-700 dark:text-slate-350 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all focus:outline-none"
                                  >
                                    <span className="text-xl font-medium leading-none mb-1">
                                      -1
                                    </span>
                                  </button>
                                  <div className="flex flex-col items-center flex-1">
                                    <input
                                      type="number"
                                      value={rVal || ""}
                                      onChange={(e) =>
                                        handleLogEdit(
                                          log.id!,
                                          isCardio || isStaticHold
                                            ? "seconds"
                                            : "reps",
                                          (
                                            parseFloat(e.target.value) || 0
                                          ).toString(),
                                        )
                                      }
                                      className="w-16 min-w-16 bg-transparent text-center text-xl font-black text-slate-900 dark:text-white focus:outline-none p-0"
                                      disabled={isCardio && false}
                                    />
                                    <span className="text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold leading-none mt-0.5 font-sans">
                                      {isCardio || isStaticHold
                                        ? "Secs"
                                        : "Reps"}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() =>
                                      handleLogEdit(
                                        log.id!,
                                        isCardio || isStaticHold
                                          ? "seconds"
                                          : "reps",
                                        (rVal + 1).toString(),
                                      )
                                    }
                                    className="w-10 h-10 shrink-0 flex items-center justify-center text-slate-700 dark:text-slate-350 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all focus:outline-none"
                                  >
                                    <span className="text-xl font-medium leading-none mb-1">
                                      +1
                                    </span>
                                  </button>
                                </div>

                                {/* Quality Bar */}
                                <div>
                                  <span className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest mb-1.5 block px-1 font-sans">
                                    Quality Grade
                                  </span>
                                  <div className="flex gap-1">
                                    {[
                                      {
                                        label: "Poor",
                                        val: 1,
                                        activeBg:
                                          "bg-cta/10 text-cta border-cta shadow-xs",
                                      },
                                      {
                                        label: "Completed",
                                        val: 2,
                                        activeBg:
                                          "bg-amber/10 text-amber border-amber shadow-xs",
                                      },
                                      {
                                        label: "Max Strength",
                                        val: 3,
                                        activeBg:
                                          "bg-green/10 text-green border-green shadow-xs",
                                      },
                                    ].map((btn) => {
                                      const isActive = quality === btn.val;
                                      return (
                                        <button
                                          key={btn.label}
                                          onClick={() =>
                                            handleLogEdit(
                                              log.id!,
                                              "repQuality",
                                              btn.val as RepQuality,
                                            )
                                          }
                                          className={cn(
                                            "flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-tighter transition-all focus:outline-none border",
                                            isActive
                                              ? btn.activeBg
                                              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800",
                                          )}
                                        >
                                          {btn.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Integrated Session Briefings */}
                    <div className="mt-8 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xl text-slate-900 dark:text-white">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-8 h-8 rounded-xl bg-cta/10 border border-cta/30 flex items-center justify-center">
                          <span className="text-cta font-black font-sans">
                            N
                          </span>
                        </div>
                        <h3 className="text-sm sm:text-base font-black uppercase tracking-[0.2em] text-slate-900 dark:text-white font-display">
                          Session Briefings & Notes
                        </h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="text-xs font-black uppercase tracking-widest text-cyan font-sans">
                              Notes Overview
                            </h4>
                          </div>
                          {isEditMode ? (
                            <Textarea
                              value={editedSessionNotes}
                              onChange={(e) =>
                                setEditedSessionNotes(e.target.value)
                              }
                              placeholder="Add or update session notes & briefings here..."
                              className="min-h-35 bg-slate-900 border-slate-700 border text-white placeholder:text-slate-600 resize-none focus-visible:ring-1 focus-visible:ring-[#F06C22] font-medium text-sm leading-relaxed p-4 rounded-xl shadow-inner"
                            />
                          ) : (
                            <div className="min-h-35 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                              <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 font-medium text-sm leading-relaxed font-sans">
                                {selectedSession.notes || (
                                  <span className="text-slate-400 italic font-sans text-xs">
                                    No historical briefings recorded.
                                  </span>
                                )}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* We could add Post-Session / Client Feel inputs here if needed. 
                            For now, using the combined notes as the primary field for this session edit interface. */}
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center mb-1">
                            <h4 className="text-cta font-sans font-black uppercase tracking-widest">
                              Client Status / Additional Context
                            </h4>
                            {isEditMode && (
                              <Select defaultValue="Medium">
                                <SelectTrigger className="w-25 h-6 bg-slate-900 border-slate-700 text-[11px] uppercase font-black tracking-widest px-2 py-0 text-slate-400">
                                  <SelectValue placeholder="Priority" />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-800 border-slate-700">
                                  <SelectItem
                                    value="High"
                                    className="text-rose-400 text-xs font-bold"
                                  >
                                    High
                                  </SelectItem>
                                  <SelectItem
                                    value="Medium"
                                    className="text-amber-400 text-xs font-bold"
                                  >
                                    Medium
                                  </SelectItem>
                                  <SelectItem
                                    value="Low"
                                    className="text-emerald-400 text-xs font-bold"
                                  >
                                    Low
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          {isEditMode ? (
                            <Textarea
                              placeholder="Add client feel, post-session debrief..."
                              className="min-h-35 bg-slate-900 border-slate-700 border text-white placeholder:text-slate-600 resize-none focus-visible:ring-1 focus-visible:ring-[#F06C22] font-medium text-sm leading-relaxed p-4 rounded-xl shadow-inner"
                            />
                          ) : (
                            <div className="min-h-35 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-center font-sans">
                              <span className="text-slate-400 dark:text-slate-500 italic text-sm font-medium font-sans">
                                Context stored in historical notes.
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 opacity-30 text-center gap-6 h-full">
                    <Clock className="w-16 h-16 text-white" />
                    <p className="text-lg font-black uppercase tracking-widest text-[#68717A]">
                      No exercise logs found for this session
                    </p>
                  </div>
                )}
              </div>

              {/* Fixed Footer for Save Button */}
              {isEditMode && (
                <div className="shrink-0 p-4 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 mt-auto flex justify-end">
                  <Button
                    onClick={handleBatchUpdate}
                    disabled={isSaving}
                    className="w-full sm:w-auto bg-[#F06C22] hover:bg-[#d95d18] text-white font-black uppercase tracking-widest h-14 px-12 rounded-xl shadow-[0_4px_20px_rgba(240,108,34,0.3)] text-lg"
                  >
                    {isSaving ? "Saving..." : "[ SAVE HISTORICAL CHANGES ]"}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md sm:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <AlertCircle className="w-6 h-6 text-red-500" />
              Delete Session?
            </DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400 font-medium">
              Are you sure you want to permanently delete this session? This
              action cannot be undone and all associated logs will be lost.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="ghost"
              onClick={() => setShowDeleteConfirm(false)}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white uppercase font-black tracking-widest text-xs h-12 rounded-xl px-6"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteSession}
              disabled={isDeletingSession}
              className="bg-red-500 hover:bg-red-600 text-white uppercase font-black tracking-widest text-xs h-12 rounded-xl px-6 transition-all"
            >
              {isDeletingSession ? "Deleting..." : "Permanently Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Session Log Dialog */}
      <Dialog open={showManualLog} onOpenChange={setShowManualLog}>
        <DialogContent className="max-w-md sm:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <PlusCircle className="w-6 h-6 text-[#F06C22]" />
              Log Past Session
            </DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400 font-medium">
              Create an empty session backbone to retroactively log exercises.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-1">
                Session Date
              </label>
              <Input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="h-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium px-4"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-1">
                Assigned Trainer
              </label>
              <select
                value={manualTrainerId}
                onChange={(e) => setManualTrainerId(e.target.value)}
                className="w-full h-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium px-4 focus:ring-1 focus:ring-[#F06C22] outline-none"
              >
                <option value="" disabled>
                  Select Trainer...
                </option>
                {trainers.map((t) => (
                  <option
                    key={t.id}
                    value={t.id}
                    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  >
                    {t.fullName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4 border-t border-slate-200 dark:border-slate-800 pt-6">
            <Button
              variant="ghost"
              onClick={() => setShowManualLog(false)}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white uppercase font-black tracking-widest text-xs h-12 rounded-xl px-6"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateManualLog}
              disabled={isSaving || !manualDate || !manualTrainerId}
              className="bg-[#F06C22] hover:bg-[#d95d18] text-white uppercase font-black tracking-widest text-xs h-12 rounded-xl px-6 transition-all"
            >
              {isSaving ? "Creating..." : "Create Backbone"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
