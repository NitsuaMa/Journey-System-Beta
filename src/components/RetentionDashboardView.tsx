import React, { useState, useMemo, useEffect } from "react";
import {
  AlertTriangle,
  Clock,
  Calendar,
  Search,
  ShieldAlert,
  Phone,
  EyeOff,
  LayoutGrid,
  MoreVertical,
  User,
  CheckCircle,
  ChevronLeft,
  Moon,
  Dumbbell,
  TrendingDown,
  Smile,
  Shield,
  ChevronDown,
  Info,
} from "lucide-react";
import { Client, WorkoutSession, Studio, Trainer, ExerciseLog } from "../types";
import { safeToDate, cn } from "../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { db } from "../firebase";
import { collection, query, getDocs, limit, orderBy } from "firebase/firestore";

export interface RetentionDashboardViewProps {
  clients: Client[];
  sessions: WorkoutSession[];
  trainers: Trainer[];
  studio: Studio | undefined;
  authTrainer: Trainer | null;
  onClose: () => void;
  onUpdateStudio: (studioId: string, updates: Partial<Studio>) => Promise<void>;
  onUpdateClient: (clientId: string, updates: Partial<Client>) => Promise<void>;
  onNavigateProfile: (clientId: string) => void;
}

type TabType = "at-risk" | "mia" | "excluded";
type RiskType =
  | "all"
  | "inactivity"
  | "sleep"
  | "stress"
  | "machines"
  | "strength";
type RiskSortType =
  | "severity"
  | "inactive-days"
  | "sleep-count"
  | "stress-count"
  | "machine-poor-count"
  | "strength-gains";

export function RetentionDashboardView({
  clients,
  sessions,
  trainers,
  studio,
  authTrainer,
  onClose,
  onUpdateStudio,
  onUpdateClient,
  onNavigateProfile,
}: RetentionDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>("at-risk");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskType>("all");
  const [riskSort, setRiskSort] = useState<RiskSortType>("severity");
  const [logs, setLogs] = useState<ExerciseLog[]>([]);

  // Self-contained fetch of recent exercise logs for machine Form ratings and Strength stagnancy tracking
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const qLogs = query(collection(db, "exerciseLogs"), limit(2000));
        const logsSnap = await getDocs(qLogs);
        const dataArr = logsSnap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as ExerciseLog,
        );
        setLogs(dataArr);
      } catch (err) {
        console.error(
          "Failed to fetch exercise logs for retention metrics:",
          err,
        );
      }
    };
    fetchLogs();
  }, [clients]);

  // Load and memoize settings with complete studio defaults
  const settings = useMemo(() => {
    const s = studio?.retentionSettings;
    return {
      atRiskThresholdDays: s?.atRiskThresholdDays ?? 7,
      miaThresholdDays: s?.miaThresholdDays ?? 14,
      autoExcludeAfterDays: s?.autoExcludeAfterDays ?? 180,
      sleepPoorCountThreshold: s?.sleepPoorCountThreshold ?? 3,
      poorMachineLogsThreshold: s?.poorMachineLogsThreshold ?? 5,
      stressLowCountThreshold: s?.stressLowCountThreshold ?? 3,
      stressLowValueThreshold: s?.stressLowValueThreshold ?? 2,
      noStrengthGainsDays: s?.noStrengthGainsDays ?? 30,
    };
  }, [studio]);

  // Handle local state form setup
  const [formSettings, setFormSettings] = useState(settings);
  useEffect(() => {
    setFormSettings(settings);
  }, [settings]);

  // Compute Last Sessions per Client
  const clientLastSessionMap = useMemo(() => {
    const map: Record<string, WorkoutSession> = {};
    sessions.forEach((s) => {
      const current = map[s.clientId];
      if (!current || safeToDate(s.date) > safeToDate(current.date)) {
        map[s.clientId] = s;
      }
    });
    return map;
  }, [sessions]);

  // Compute Risk Factors & Stagnation for ALL Clients
  const clientRiskMap = useMemo(() => {
    const map: Record<string, any> = {};

    clients.forEach((c) => {
      const clientSessions = sessions
        .filter((s) => s.clientId === c.id && s.status === "Completed")
        .sort(
          (a, b) => safeToDate(b.date).getTime() - safeToDate(a.date).getTime(),
        );

      const clientLogs = logs.filter((l) => l.clientId === c.id);

      const flags: {
        type: RiskType;
        label: string;
        count?: number;
        detail: string;
        severity: "low" | "medium" | "high";
      }[] = [];

      // 1. Poor sleep quality
      const sleepPoorCount = clientSessions.filter(
        (s) => s.preSessionCheckIn?.sleepQuality === "poor",
      ).length;
      if (sleepPoorCount >= settings.sleepPoorCountThreshold) {
        flags.push({
          type: "sleep",
          label: "Poor Sleep Frequency",
          count: sleepPoorCount,
          detail: `${sleepPoorCount} sessions with poor sleep quality (Limit: ${settings.sleepPoorCountThreshold})`,
          severity: "medium",
        });
      }

      // 2. Stress level too low
      const stressLowCount = clientSessions.filter((s) => {
        const stress = s.preSessionCheckIn?.stressLevel;
        return stress && stress <= settings.stressLowValueThreshold;
      }).length;
      if (stressLowCount >= settings.stressLowCountThreshold) {
        flags.push({
          type: "stress",
          label: "Low Stress Rated Too Often",
          count: stressLowCount,
          detail: `${stressLowCount} check-ins with stress level ≤ ${settings.stressLowValueThreshold} (Limit: ${settings.stressLowCountThreshold})`,
          severity: "medium",
        });
      }

      // 3. Poor machine ratings
      const poorMachineCount = clientLogs.filter(
        (l) => l.repQuality === 1,
      ).length;
      if (poorMachineCount >= settings.poorMachineLogsThreshold) {
        flags.push({
          type: "machines",
          label: "Poor Biomechanics Form",
          count: poorMachineCount,
          detail: `${poorMachineCount} machine sets rated poor (Limit: ${settings.poorMachineLogsThreshold})`,
          severity: "high",
        });
      }

      // 4. Stagnation (Strength Gains)
      let daysBetween = 0;
      let hasNoStrengthGains = false;
      let strengthGainsText = "";
      let avgGain = 0;

      if (clientSessions.length >= 2) {
        const sortedAsc = [...clientSessions].sort(
          (a, b) => safeToDate(a.date).getTime() - safeToDate(b.date).getTime(),
        );
        const firstSess = sortedAsc[0];
        const lastSess = sortedAsc[sortedAsc.length - 1];
        daysBetween = Math.ceil(
          Math.abs(
            safeToDate(lastSess.date).getTime() -
              safeToDate(firstSess.date).getTime(),
          ) /
            (1000 * 60 * 60 * 24),
        );

        if (daysBetween >= settings.noStrengthGainsDays) {
          // Group exercises by machine
          const logsByMachine: Record<string, ExerciseLog[]> = {};
          clientLogs.forEach((l) => {
            if (!l.machineId) return;
            if (!logsByMachine[l.machineId]) logsByMachine[l.machineId] = [];
            logsByMachine[l.machineId].push(l);
          });

          const machineGains: number[] = [];
          Object.entries(logsByMachine).forEach(([machineId, mLogs]) => {
            const sortedMLogs = [...mLogs].sort((a, b) => {
              const timeA = a.createdAt?.seconds || 0;
              const timeB = b.createdAt?.seconds || 0;
              return timeA - timeB;
            });

            const weights = sortedMLogs
              .map((l) => parseFloat(l.weight || "0"))
              .filter((w) => w > 0);
            if (weights.length >= 2) {
              const startW = weights[0];
              const endW = weights[weights.length - 1];
              if (startW > 0) {
                const gain = ((endW - startW) / startW) * 100;
                machineGains.push(gain);
              }
            }
          });

          if (machineGains.length >= 2) {
            avgGain =
              machineGains.reduce((sum, g) => sum + g, 0) / machineGains.length;
            if (avgGain <= 0) {
              hasNoStrengthGains = true;
              strengthGainsText = `${avgGain.toFixed(1)}% avg gain across ${machineGains.length} exercises`;
              flags.push({
                type: "strength",
                label: "Negative or Stagnant Gains",
                detail: `${strengthGainsText} over ${daysBetween} days training`,
                severity: "high",
              });
            }
          }
        }
      }

      map[c.id as string] = {
        flags,
        sleepPoorCount,
        stressLowCount,
        poorMachineCount,
        hasNoStrengthGains,
        strengthGainsText,
        avgGain,
        daysBetween,
      };
    });

    return map;
  }, [clients, sessions, logs, settings]);

  // Compute Buckets
  const { atRisk, mia, excluded, stagnationCount } = useMemo(() => {
    const now = new Date();
    const atRiskArr: any[] = [];
    const miaArr: any[] = [];
    const excludedArr: any[] = [];
    let stagCount = 0;

    clients.forEach((c) => {
      const lastSession = clientLastSessionMap[c.id as string];
      const trainerId = lastSession?.trainerId;
      const trainer = trainers.find((t) => t.id === trainerId) || trainers[0]; // fallback

      const lastDate = lastSession
        ? safeToDate(lastSession.date)
        : safeToDate(c.createdAt || now);
      const diffTime = Math.abs(now.getTime() - lastDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const riskFactors = clientRiskMap[c.id as string] || {
        flags: [],
        sleepPoorCount: 0,
        stressLowCount: 0,
        poorMachineCount: 0,
        hasNoStrengthGains: false,
        avgGain: 0,
      };

      if (riskFactors.hasNoStrengthGains) {
        stagCount++;
      }

      const entry = {
        client: c,
        lastSession,
        trainer,
        diffDays,
        lastDate,
        riskFactors,
      };

      // Check active absences
      const activeAbsence = c.events?.some((e) => {
        if (
          e.type !== "Vacation" &&
          e.type !== "Medical" &&
          e.type !== "Snowbird"
        )
          return false;
        if (!e.date) return false;
        let start = safeToDate(e.date);
        start.setHours(0, 0, 0, 0);
        let end = e.endDate ? safeToDate(e.endDate) : start;
        end.setHours(23, 59, 59, 999);
        return now >= start && now <= end;
      });

      if (c.retentionMeta?.excludedFromMIA || activeAbsence) {
        excludedArr.push({
          ...entry,
          excludedReason: activeAbsence
            ? "Active Absence"
            : c.retentionMeta?.excludedReason,
        });
      } else if (c.remainingSessions > 0) {
        // Evaluate dynamic at-risk thresholds
        const triggerInactivityRisk =
          diffDays >= settings.atRiskThresholdDays &&
          diffDays < settings.miaThresholdDays;

        let clientFlags = [...riskFactors.flags];
        if (triggerInactivityRisk) {
          clientFlags.unshift({
            type: "inactivity",
            label: "Inactivity Check",
            detail: `${diffDays} days inactive (Threshold: ${settings.atRiskThresholdDays}d)`,
            severity: "low",
          });
        }

        // Re-inject inactivity flags into final entry copy
        const finalEntry = {
          ...entry,
          riskFactors: {
            ...riskFactors,
            flags: clientFlags,
          },
        };

        if (diffDays >= settings.miaThresholdDays) {
          if (diffDays <= settings.autoExcludeAfterDays) {
            miaArr.push(finalEntry);
          } else {
            excludedArr.push({
              ...finalEntry,
              autoExcluded: true,
              excludedReason: "Auto-excluded due to massive elapsed inactivity",
            });
          }
        } else if (clientFlags.length > 0) {
          atRiskArr.push(finalEntry);
        }
      }
    });

    return {
      atRisk: atRiskArr,
      mia: miaArr.sort((a, b) => b.diffDays - a.diffDays),
      excluded: excludedArr.sort((a, b) => b.diffDays - a.diffDays),
      stagnationCount: stagCount,
    };
  }, [clients, clientLastSessionMap, trainers, clientRiskMap, settings]);

  // Compute final reactive list
  const processedList = useMemo(() => {
    if (activeTab === "at-risk") {
      let list = [...atRisk];

      // Apply Risk Type Filter
      if (riskFilter !== "all") {
        list = list.filter((item) =>
          item.riskFactors.flags.some((f: any) => f.type === riskFilter),
        );
      }

      // Apply Search Filter
      list = list.filter((item) =>
        `${item.client.firstName} ${item.client.lastName}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      );

      // Apply Sort Order
      list.sort((a, b) => {
        if (riskSort === "severity") {
          const diff = b.riskFactors.flags.length - a.riskFactors.flags.length;
          if (diff !== 0) return diff;
          return b.diffDays - a.diffDays;
        }
        if (riskSort === "inactive-days") {
          return b.diffDays - a.diffDays;
        }
        if (riskSort === "sleep-count") {
          return b.riskFactors.sleepPoorCount - a.riskFactors.sleepPoorCount;
        }
        if (riskSort === "stress-count") {
          return b.riskFactors.stressLowCount - a.riskFactors.stressLowCount;
        }
        if (riskSort === "machine-poor-count") {
          return (
            b.riskFactors.poorMachineCount - a.riskFactors.poorMachineCount
          );
        }
        if (riskSort === "strength-gains") {
          const valA = a.riskFactors.hasNoStrengthGains
            ? a.riskFactors.avgGain
            : 9999;
          const valB = b.riskFactors.hasNoStrengthGains
            ? b.riskFactors.avgGain
            : 9999;
          return valA - valB; // Lowest gains first
        }
        return 0;
      });

      return list;
    } else {
      const list = activeTab === "mia" ? mia : excluded;
      return list.filter((item) =>
        `${item.client.firstName} ${item.client.lastName}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      );
    }
  }, [atRisk, mia, excluded, activeTab, riskFilter, riskSort, searchQuery]);

  const handleSaveSettings = async () => {
    if (studio?.id) {
      await onUpdateStudio(studio.id, { retentionSettings: formSettings });
      setShowSettings(false);
    }
  };

  const markContacted = async (clientId: string) => {
    await onUpdateClient(clientId, {
      retentionMeta: {
        ...(clients.find((c) => c.id === clientId)?.retentionMeta || {}),
        lastContactedDate: new Date(),
      },
    });
  };

  const toggleExclude = async (clientId: string, exclude: boolean) => {
    const defaultMeta =
      clients.find((c) => c.id === clientId)?.retentionMeta || {};
    await onUpdateClient(clientId, {
      retentionMeta: {
        ...defaultMeta,
        excludedFromMIA: exclude,
        excludedBy: exclude ? authTrainer?.fullName : undefined,
        excludedReason: exclude
          ? "Manual override via Retention Dashboard"
          : undefined,
      },
    });
  };

  return (
    <div className="w-full h-full min-h-screen text-slate-900 dark:text-slate-100 font-sans flex flex-col overflow-hidden p-3 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto w-full h-full relative flex flex-col pb-24 shadow-sm">
        <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 flex flex-col pt-2">
          <div className="py-2 flex-1 flex flex-col gap-4">
            {/* Header Area with Integrated Back Button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="flex items-center justify-center h-10 w-10 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
                  title="Back to Dashboard"
                >
                  <ChevronLeft className="w-5 h-5 text-[#F06C22]" />
                </button>
                <div>
                  <h1 className="font-display italic font-bold uppercase text-2xl sm:text-3xl text-slate-900 dark:text-white leading-tight">
                    Retention Tracker
                  </h1>
                  <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                    Protect and support your active client base
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center justify-center h-10 w-10 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
                title="Retention Warnings Configuration"
              >
                <LayoutGrid className="w-5 h-5 text-[#F06C22]" />
              </button>
            </div>

            {/* Metric Bento (3 Cards - including Strength Stagnation) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div
                onClick={() => {
                  setActiveTab("at-risk");
                  setRiskFilter("all");
                }}
                className={cn(
                  "flex flex-col p-4 rounded-2xl border transition-all cursor-pointer h-28 justify-between shadow-sm",
                  activeTab === "at-risk" && riskFilter !== "strength"
                    ? "bg-amber-500/10 dark:bg-amber-950/20 border-amber-500/50 ring-1 ring-amber-500/20"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700",
                )}
              >
                <Clock
                  className={cn(
                    "w-5 h-5",
                    activeTab === "at-risk" && riskFilter !== "strength"
                      ? "text-amber-500"
                      : "text-slate-400",
                  )}
                />
                <div>
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white leading-none block">
                    {atRisk.length}
                  </span>
                  <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                    At Risk Clients
                  </span>
                </div>
              </div>

              <div
                onClick={() => {
                  setActiveTab("mia");
                }}
                className={cn(
                  "flex flex-col p-4 rounded-2xl border transition-all cursor-pointer h-28 justify-between shadow-sm",
                  activeTab === "mia"
                    ? "bg-rose-500/10 dark:bg-rose-950/20 border-rose-500/50 ring-1 ring-rose-500/20"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700",
                )}
              >
                <ShieldAlert
                  className={cn(
                    "w-5 h-5",
                    activeTab === "mia" ? "text-rose-500" : "text-slate-400",
                  )}
                />
                <div>
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white leading-none block">
                    {mia.length}
                  </span>
                  <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                    MIA ({settings.miaThresholdDays}d+)
                  </span>
                </div>
              </div>

              {/* Strength Stagnation Bento Dashboard */}
              <div
                onClick={() => {
                  setActiveTab("at-risk");
                  setRiskFilter("strength");
                }}
                className={cn(
                  "flex flex-col p-4 rounded-2xl border transition-all cursor-pointer h-28 justify-between relative overflow-hidden shadow-sm",
                  activeTab === "at-risk" && riskFilter === "strength"
                    ? "bg-sky-500/10 dark:bg-sky-950/20 border-sky-500/50 ring-1 ring-sky-500/20"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700",
                )}
                title="Click to view clients with stagnation"
              >
                <div className="flex justify-between items-center">
                  <TrendingDown
                    className={cn(
                      "w-5 h-5",
                      activeTab === "at-risk" && riskFilter === "strength"
                        ? "text-[#38BDF8]"
                        : "text-rose-400",
                    )}
                  />
                  <span className="text-[9px] bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/20 rounded px-1.5 py-0.5 font-bold uppercase tracking-widest hidden sm:inline-block">
                    Watchlist
                  </span>
                </div>
                <div>
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white leading-none block">
                    {stagnationCount}
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-500 dark:text-rose-400">
                    Stagnant Gains
                  </span>
                </div>
              </div>
            </div>

            {/* Filter Explanation Banner */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 sm:p-3.5 flex gap-2.5 items-start text-xs text-slate-700 dark:text-slate-300">
              <Info className="w-4 h-4 text-[#F06C22] shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-900 dark:text-white font-extrabold uppercase mr-1">
                  At Risk Metrics:
                </span>
                Clients trigger dynamic warning flags due to{" "}
                {settings.atRiskThresholdDays}+ days inactivity,{" "}
                {settings.sleepPoorCountThreshold}+ poor sleeps,{" "}
                {settings.poorMachineLogsThreshold}+ poor form ratings,{" "}
                {settings.stressLowCountThreshold}+ stress check-ins &le;{" "}
                {settings.stressLowValueThreshold}, or stagnant strength gains
                at {settings.noStrengthGainsDays}d.
              </div>
            </div>

            {/* List and Controls Container */}
            <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex gap-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-1 rounded-xl">
                    <button
                      onClick={() => {
                        setActiveTab("at-risk");
                        setRiskFilter("all");
                      }}
                      className={cn(
                        "px-3 py-1.5 font-display italic font-bold uppercase rounded-lg text-xs transition-colors min-h-9.5 cursor-pointer select-none",
                        activeTab === "at-risk"
                          ? "bg-white dark:bg-slate-800 text-[#F06C22] dark:text-[#F06C22] shadow-sm border border-slate-200 dark:border-slate-700 font-black"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white",
                      )}
                    >
                      At Risk ({atRisk.length})
                    </button>
                    <button
                      onClick={() => setActiveTab("mia")}
                      className={cn(
                        "px-3 py-1.5 font-display italic font-bold uppercase rounded-lg text-xs transition-colors min-h-9.5 cursor-pointer select-none",
                        activeTab === "mia"
                          ? "bg-white dark:bg-slate-800 text-[#F06C22] dark:text-[#F06C22] shadow-sm border border-slate-200 dark:border-slate-700 font-black"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white",
                      )}
                    >
                      MIA ({mia.length})
                    </button>
                    <button
                      onClick={() => setActiveTab("excluded")}
                      className={cn(
                        "px-3 py-1.5 font-display italic font-bold uppercase rounded-lg text-xs transition-all min-h-9.5 cursor-pointer select-none",
                        activeTab === "excluded"
                          ? "bg-white dark:bg-slate-800 text-[#F06C22] dark:text-[#F06C22] shadow-sm border border-slate-200 dark:border-slate-700 font-black"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white",
                      )}
                    >
                      Excluded ({excluded.length})
                    </button>
                  </div>

                  <div className="relative w-full sm:w-56 shrink-0">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl h-10 pl-9 pr-3 text-xs text-slate-900 dark:text-white focus-visible:outline-none placeholder:text-slate-400 focus:border-[#F06C22] font-semibold"
                      placeholder="Search clients..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                {/* Sorting and Risk Filter Controls (Rendered on At-Risk Tab) */}
                {activeTab === "at-risk" && (
                  <div className="flex items-center gap-3 border-t border-slate-100 dark:border-slate-800 pt-3 mt-1 flex-wrap text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase">
                    {/* RISK FACTOR FILTER */}
                    <div className="flex items-center gap-2 flex-1 min-w-55">
                      <span className="shrink-0">Filter Risk:</span>
                      <div className="relative flex-1 min-w-0">
                        <select
                          value={riskFilter}
                          onChange={(e) =>
                            setRiskFilter(e.target.value as RiskType)
                          }
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg h-9 px-2.5 pr-7 text-xs font-bold text-slate-900 dark:text-white focus-visible:outline-none focus:border-[#F06C22] appearance-none cursor-pointer"
                        >
                          <option value="all">
                            ⚠️ Show All Flags ({atRisk.length})
                          </option>
                          <option value="inactivity">
                            📅 Inactivity Alerts
                          </option>
                          <option value="sleep">🌙 Poor Sleep Quality</option>
                          <option value="stress">
                            ⚡ Low Stress Check-ins
                          </option>
                          <option value="machines">
                            💪 Poor Biomechanics Form
                          </option>
                          <option value="strength">
                            📉 No Strength Gains ({stagnationCount})
                          </option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* RISK SORT CONTROL */}
                    <div className="flex items-center gap-2 flex-1 min-w-55">
                      <span className="shrink-0">Sort By:</span>
                      <div className="relative flex-1 min-w-0">
                        <select
                          value={riskSort}
                          onChange={(e) =>
                            setRiskSort(e.target.value as RiskSortType)
                          }
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg h-9 px-2.5 pr-7 text-xs font-bold text-slate-900 dark:text-white focus-visible:outline-none focus:border-[#F06C22] appearance-none cursor-pointer"
                        >
                          <option value="severity">
                            🔥 Multi-Metric Risk Severity
                          </option>
                          <option value="inactive-days">
                            📅 Inactive Days (High to Low)
                          </option>
                          <option value="sleep-count">
                            🌙 Poor Sleep Rating Frequency
                          </option>
                          <option value="stress-count">
                            ⚡ Low Stress Instances Count
                          </option>
                          <option value="machine-poor-count">
                            💪 Poor Form Machine Sets
                          </option>
                          <option value="strength-gains">
                            📈 Stagnation: Stagnant/Negative %
                          </option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-ink-d3 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Main List Scroller */}
              <div className="flex-1 overflow-y-auto no-scrollbar p-0">
                {processedList.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400 my-8">
                    <span className="text-[48px] mb-2 font-emoji">💎</span>
                    <h3 className="font-display italic font-bold uppercase text-[18px] text-slate-900 dark:text-white mb-1">
                      Board Clear
                    </h3>
                    <p className="text-[12px] max-w-sm text-slate-500 dark:text-slate-400">
                      No clients match this warning filter currently.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {processedList.map((item) => {
                      // Retrieve list of flagging reasons for At Risk
                      const activeFlags = item.riskFactors?.flags || [];

                      return (
                        <div
                          key={item.client.id}
                          className="border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group gap-4"
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            {/* Visual strip indicating hazard rating */}
                            <div
                              className={cn(
                                "w-1 h-14 rounded-full shrink-0 self-center",
                                activeTab === "mia"
                                  ? "bg-rose-500"
                                  : activeTab === "excluded"
                                    ? "bg-slate-400"
                                    : activeFlags.length >= 3
                                      ? "bg-rose-500 animate-pulse"
                                      : activeFlags.length >= 2
                                        ? "bg-amber-500"
                                        : "bg-[#38BDF8]",
                              )}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-display italic font-bold uppercase text-base text-slate-900 dark:text-white group-hover:text-[#F06C22] transition-colors">
                                  {item.client.firstName} {item.client.lastName}
                                </h4>
                                <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-bold">
                                  {item.client.remainingSessions} LFT
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold">
                                <span className="text-amber-500 dark:text-amber-400 font-bold">
                                  Last Train: {item.diffDays}d ago
                                </span>
                                <span className="text-slate-400 dark:text-slate-500">
                                  Trainer: {item.trainer?.fullName}
                                </span>
                                {item.client.retentionMeta
                                  ?.lastContactedDate && (
                                  <span className="text-[#38BDF8] font-bold lowercase flex items-center gap-1">
                                    ♥ contacted{" "}
                                    {safeToDate(
                                      item.client.retentionMeta
                                        .lastContactedDate,
                                    ).toLocaleDateString()}
                                  </span>
                                )}
                              </div>

                              {/* STUNNING RISK REASONS CHIPS CONTAINER (Only on At Risk Tab) */}
                              {activeTab === "at-risk" &&
                                activeFlags.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {activeFlags.map(
                                      (flag: any, fIdx: number) => {
                                        let iconEl = (
                                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                                        );
                                        let chipColor =
                                          "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20";

                                        if (flag.type === "sleep") {
                                          iconEl = (
                                            <Moon className="w-3 h-3 text-violet-500 shrink-0" />
                                          );
                                          chipColor =
                                            "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20";
                                        } else if (flag.type === "stress") {
                                          iconEl = (
                                            <Smile className="w-3 h-3 text-orange-500 shrink-0" />
                                          );
                                          chipColor =
                                            "bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/20";
                                        } else if (flag.type === "machines") {
                                          iconEl = (
                                            <Dumbbell className="w-3 h-3 text-rose-500 shrink-0" />
                                          );
                                          chipColor =
                                            "bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20";
                                        } else if (flag.type === "strength") {
                                          iconEl = (
                                            <TrendingDown className="w-3 h-3 text-[#38BDF8] shrink-0" />
                                          );
                                          chipColor =
                                            "bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/20";
                                        }

                                        return (
                                          <div
                                            key={fIdx}
                                            className={cn(
                                              "flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-sans border tracking-wide font-bold",
                                              chipColor,
                                            )}
                                            title={flag.detail}
                                          >
                                            {iconEl}
                                            <span>{flag.label}</span>
                                            <span className="opacity-70 bg-black/5 dark:bg-white/10 px-1 rounded text-[8px] font-mono">
                                              {flag.count || "✓"}
                                            </span>
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                )}
                            </div>
                          </div>

                          {/* Controls Panel */}
                          <div className="flex items-center gap-1.5 sm:gap-2 justify-end sm:shrink-0 self-end sm:self-center">
                            {/* Profile Direct Access Fast-Action */}
                            <button
                              onClick={() =>
                                item.client.id &&
                                onNavigateProfile(item.client.id)
                              }
                              className="h-9 px-3 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-[11px] font-bold uppercase text-slate-800 dark:text-slate-200 hover:text-[#F06C22] tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <User className="w-3.5 h-3.5" />
                              Profile
                            </button>

                            <DropdownMenu>
                              <DropdownMenuTrigger className="h-9 w-9 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">
                                <MoreVertical className="w-4 h-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="w-50 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-2xl p-1 shadow-lg"
                              >
                                <DropdownMenuItem
                                  onClick={() =>
                                    item.client.id &&
                                    markContacted(item.client.id)
                                  }
                                  className="min-h-10 rounded-xl text-xs font-bold uppercase tracking-wide text-[#38BDF8] hover:bg-sky-500/10 focus:bg-sky-500/10 cursor-pointer"
                                >
                                  <Phone className="w-4 h-4 mr-2" /> Mark
                                  Contacted
                                </DropdownMenuItem>
                                {activeTab !== "excluded" ? (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      item.client.id &&
                                      toggleExclude(item.client.id, true)
                                    }
                                    className="min-h-10 rounded-xl text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                  >
                                    <EyeOff className="w-4 h-4 mr-2" /> Exclude
                                    Alerts
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      item.client.id &&
                                      toggleExclude(item.client.id, false)
                                    }
                                    className="min-h-10 rounded-xl text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                  >
                                    <CheckCircle className="w-4 h-4 mr-2" />{" "}
                                    Re-Include Client
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CUSTOM STUDIO RETENTION SETTINGS DIALOG */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-105 bg-bg-dark border-div-d rounded-3xl p-6 overflow-y-auto max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle className="font-display italic font-bold uppercase text-[24px] text-ink-d1">
              Retention Alerts
            </DialogTitle>
            <DialogDescription className="text-ink-d3 text-[11px] uppercase tracking-wider">
              Customize warning triggers for {studio?.name || "the studio"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 mt-4 font-sans">
            {/* Inactivity Threshold */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-div-d/40 pb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                  At Risk Days Inactive
                </label>
                <input
                  type="number"
                  value={formSettings.atRiskThresholdDays}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      atRiskThresholdDays: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                  MIA Days Inactive
                </label>
                <input
                  type="number"
                  value={formSettings.miaThresholdDays}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      miaThresholdDays: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
                />
              </div>
            </div>

            {/* AutoExclude Days */}
            <div className="flex flex-col gap-1.5 border-b border-div-d/40 pb-4">
              <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                Auto-Exclude (Days Inactive)
              </label>
              <input
                type="number"
                value={formSettings.autoExcludeAfterDays}
                onChange={(e) =>
                  setFormSettings({
                    ...formSettings,
                    autoExcludeAfterDays: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
              />
              <p className="text-[10px] text-ink-d3 font-sans">
                Stop flagging inactive clients after this many days.
              </p>
            </div>

            {/* Sleep Rating Customize */}
            <div className="flex flex-col gap-1.5 border-b border-div-d/40 pb-4">
              <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                Sleep Quality Warnings Limit
              </label>
              <input
                type="number"
                value={formSettings.sleepPoorCountThreshold}
                onChange={(e) =>
                  setFormSettings({
                    ...formSettings,
                    sleepPoorCountThreshold: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
              />
              <p className="text-[10px] text-ink-d3 font-sans">
                Flag as at-risk if they record poor sleep quality &ge; this many
                times.
              </p>
            </div>

            {/* Machine Rating Customize */}
            <div className="flex flex-col gap-1.5 border-b border-div-d/40 pb-4">
              <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                Poor Machine Ratings Limit
              </label>
              <input
                type="number"
                value={formSettings.poorMachineLogsThreshold}
                onChange={(e) =>
                  setFormSettings({
                    ...formSettings,
                    poorMachineLogsThreshold: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
              />
              <p className="text-[10px] text-ink-d3 font-sans">
                Flag if client receives &ge; this many "Poor" exercise form
                ratings.
              </p>
            </div>

            {/* Stress Level Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-div-d/40 pb-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                  Low Stress Limit (&le; x)
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={formSettings.stressLowValueThreshold}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      stressLowValueThreshold: parseInt(e.target.value) || 1,
                    })
                  }
                  className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                  Warnings Count
                </label>
                <input
                  type="number"
                  value={formSettings.stressLowCountThreshold}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      stressLowCountThreshold: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
                />
              </div>
              <p className="text-[10px] text-ink-d3 font-sans col-span-2">
                Flag client if their stress score &le; Limit is rated &ge; Warn
                Count times.
              </p>
            </div>

            {/* Strength Gains Watchlist Customize */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-ink-d2">
                Strength Gains Evaluate Period (Days)
              </label>
              <input
                type="number"
                value={formSettings.noStrengthGainsDays}
                onChange={(e) =>
                  setFormSettings({
                    ...formSettings,
                    noStrengthGainsDays: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full bg-surface-1 border border-div-d rounded-xl px-3 h-10 text-ink-d1 text-[14px] focus-visible:outline-none focus:ring-1 focus:ring-cyan"
              />
              <p className="text-[10px] text-ink-d3 font-sans">
                Flag clients with 0% or negative average strength gains over
                this many training days.
              </p>
            </div>

            <Button
              onClick={handleSaveSettings}
              className="w-full h-11 bg-cyan text-slate-900 hover:bg-cyan/90 font-display italic font-bold uppercase rounded-full text-[14px] mt-4 focus-visible:outline-none"
            >
              SAVE AMENDED WARNINGS
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
