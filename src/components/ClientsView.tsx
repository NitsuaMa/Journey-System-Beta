import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Users,
  History,
  Play,
  Loader2,
  CalendarCheck,
  ListChecks,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { Client, Trainer, View, WorkoutSession } from "../types";
import { isFuzzyNameMatch } from "../lib/sync-utils";
import { ScheduleBlock } from "./schedule/ScheduleBlock";
import { useStudioTasks } from "../features/studio-tasks";
import {
  zonedHM,
  calendarLabelKey,
  studioDayBoundsForKey,
  studioDateKey,
} from "../lib/studio-time";
import {
  safeToDate,
  getMillis,
  isSessionValid,
  parseSessionDate,
} from "../lib/utils";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/** Grid geometry. Row height is fixed so the NOW line can be placed in px. */
const SLOT_MINUTES = 30;
/** Height of one 30-minute row (Tailwind h-14). */
const ROW_PX = 56;
/** Height of the sticky trainer header row (Tailwind h-16). */
const HEADER_PX = 64;
/**
 * The timeline runs 5:30 AM -> 8:00 PM. Trainers take early exceptions and
 * late make-ups, and the old 7 AM floor hid them below the scroll. A booking
 * outside this window still stretches the grid to include it.
 */
const DEFAULT_START_MIN = 5 * 60 + 30;
/** The LAST row STARTS here, so the grid closes at 8:00 PM. */
const DEFAULT_END_MIN = 19 * 60 + 30;
/** Minimum width per trainer column before the grid scrolls sideways. */
const MIN_COLUMN_PX = 144;
const TIME_AXIS_PX = 56;

/** "7 AM", "12 PM", "6:30 AM" … for the left time axis. */
const hourLabel = (minutes: number): string => {
  const h24 = Math.floor(minutes / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = minutes % 60;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h24 >= 12 ? "PM" : "AM"}`;
};

/**
 * One number in the Hub's day strip.
 *
 * Value over label, tabular figures so the pair does not shift width as the
 * day fills up. The accent lives on the number
 * alone; the label stays grey. A trainer scanning this row is reading
 * digits, not chrome.
 */
function DayStat({
  value,
  label,
  sub,
  icon,
  tone,
  title,
}: {
  value: number | string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
  title: string;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 px-2.5 md:px-3 bg-white dark:bg-slate-900"
      title={title}
    >
      <span className={cn("shrink-0 hidden md:block opacity-70", tone)}>
        {icon}
      </span>
      <span className="flex flex-col justify-center leading-none gap-0.5">
        <span className="flex items-baseline gap-1">
          <span className={cn("text-base font-black tabular-nums", tone)}>
            {value}
          </span>
          {sub && (
            <span className="text-[10px] font-bold tabular-nums text-slate-400 dark:text-slate-500">
              {sub}
            </span>
          )}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {label}
        </span>
      </span>
    </div>
  );
}

export function ClientsView({
  clients,
  trainers,
  sortedTrainers,
  activeStudioId,
  onSelectClient,
  setView,
  schedules,
  sessions,
  editingClient,
  setEditingClient,
  formData,
  setFormData,
  onSubmit,
  setSelectedSessionId,
  authTrainer,
  searchTerm,
  onSearchTermChange,
}: {
  clients: Client[];
  trainers: Trainer[];
  sortedTrainers: Trainer[];
  isAdmin: boolean;
  activeStudioId: string;
  authTrainer: Trainer | null;
  onSelectClient: (id: string) => void;
  setView: (v: View) => void;
  schedules: any[];
  sessions: WorkoutSession[];
  editingClient: Client | null;
  setEditingClient: (c: Client | null) => void;
  formData: any;
  setFormData: (f: any) => void;
  onSubmit: (e: React.FormEvent) => void;
  startEdit: (c: Client) => void;
  updateSessions: (id: string, current: number, delta: number) => void;
  setSelectedSessionId: (id: string | null) => void;
  onSelectTrainer?: (id: string) => void;
  /** Search term owned by the app shell (the input lives in the header). */
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
}) {
  const [dbSearchResults, setDbSearchResults] = useState<Client[]>([]);
  const [isSearchingDb, setIsSearchingDb] = useState(false);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const selectedDayRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Sync / search database in real-time when trainer searches on main screen
  useEffect(() => {
    if (!searchTerm.trim()) {
      setDbSearchResults([]);
      return;
    }
    const fetchClients = async () => {
      setIsSearchingDb(true);
      try {
        const term = searchTerm.trim().toLowerCase();
        const alphaOnly = term.replace(/[^a-z]/g, "");
        const prefixLen = alphaOnly.length > 3 ? 3 : alphaOnly.length;
        const prefix = alphaOnly.slice(0, prefixLen);
        const prefixCapitalized =
          prefix.charAt(0).toUpperCase() + prefix.slice(1);

        if (!prefixCapitalized) {
          setDbSearchResults([]);
          return;
        }

        const clientsRef = collection(db, "clients");
        const q1 = query(
          clientsRef,
          where("firstName", ">=", prefixCapitalized),
          where("firstName", "<=", prefixCapitalized + "\uf8ff"),
          limit(30),
        );
        const q2 = query(
          clientsRef,
          where("lastName", ">=", prefixCapitalized),
          where("lastName", "<=", prefixCapitalized + "\uf8ff"),
          limit(30),
        );

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const uniqueDocs = new Map<string, any>();
        [...snap1.docs, ...snap2.docs].forEach((d) => {
          uniqueDocs.set(d.id, { id: d.id, ...d.data() });
        });

        const candidates = Array.from(uniqueDocs.values());
        const fetched = candidates.filter((c) => {
          const first = (c.firstName || "").toLowerCase();
          const last = (c.lastName || "").toLowerCase();
          const full = `${first} ${last}`;
          const mb = (c.mindbody_name || "").toLowerCase();

          return (
            first.includes(term) ||
            last.includes(term) ||
            full.includes(term) ||
            mb.includes(term) ||
            term.includes(first) ||
            term.includes(last) ||
            isFuzzyNameMatch(
              term,
              c.firstName || "",
              c.lastName || "",
              c.mindbody_name,
            )
          );
        });

        setDbSearchResults(fetched);
      } catch (err) {
        console.error("Error searching matching clients in main search:", err);
      } finally {
        setIsSearchingDb(false);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      fetchClients();
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const filteredClients = clients.filter((c) =>
    `${c.firstName} ${c.lastName}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase()),
  );

  // Merge local filtered clients of today and dynamic DB search results uniquely by client ID
  const mergedSearchClients = Array.from(
    new Map(
      [...filteredClients, ...dbSearchResults].map((c) => [c.id, c]),
    ).values(),
  );

  const now = new Date();

  const isSelfTrainer = (t: { id?: string; fullName?: string }): boolean => {
    if (!authTrainer) return false;
    if (t.id && authTrainer.id && String(t.id) === String(authTrainer.id))
      return true;
    const a = (t.fullName || "").trim().toLowerCase();
    const b = (authTrainer.fullName || "").trim().toLowerCase();
    return !!a && a === b;
  };

  /**
   * Structural, not `Trainer`: the visible list mixes real trainer documents
   * with the lightweight stand-ins built for names that appear on the
   * schedule but have no roster row. Both carry an id and a name, which is
   * all this reads.
   */
  const isTrainerMatch = (
    s: any,
    trainer: { id?: string; fullName?: string },
  ): boolean => {
    if (!s || !trainer) return false;
    const sId = s.trainerId || s.staffId || s.StaffId;
    if (sId && trainer.id && String(sId) === String(trainer.id)) return true;

    const sName = (s.trainerName || s.staffName || s.StaffFirstName || "")
      .trim()
      .toLowerCase();
    const tFull = (trainer.fullName || "").trim().toLowerCase();
    const tFirst = ((trainer as any).firstName || trainer.fullName || "")
      .split(" ")[0]
      .trim()
      .toLowerCase();

    if (!sName || !tFull) return false;
    if (sName === tFull) return true;
    if (tFirst.length >= 2 && sName === tFirst) return true;
    if (
      sName.length >= 3 &&
      tFull.length >= 3 &&
      (sName.includes(tFull) || tFull.includes(sName))
    ) {
      return true;
    }
    return false;
  };

  /**
   * Minutes since the studio's midnight, snapped down to the 30-minute row
   * the appointment starts in. Numbers instead of "7:30 AM" strings keep the
   * row math trivial (a 60-minute session spans two rows, and so on).
   */
  const studioMinutes = (date: Date): number => {
    const hm = zonedHM(date);
    return hm ? hm.hour * 60 + hm.minute : 0;
  };
  const slotOf = (s: any): number | null => {
    const date = safeToDate(s?.startTime || s?.StartDateTime || s?.date);
    if (!date) return null;
    return Math.floor(studioMinutes(date) / SLOT_MINUTES) * SLOT_MINUTES;
  };

  // Sessions for the selected day, bounded by the STUDIO's midnight. Using the
  // viewer's midnight here while reading hours in studio time selected a window
  // offset from the studio's day, which scattered a normal 7am-8pm schedule
  // across every hour from 12 AM to 11:30 PM.
  const { start: dateStart, end: dateEnd } = studioDayBoundsForKey(
    calendarLabelKey(selectedDate),
  );

  const todaysSchedules = (schedules || [])
    .filter((s) => {
      const date = safeToDate(s.startTime || s.StartDateTime || s.date);
      if (!date) return false;
      return date >= dateStart && date <= dateEnd && s.status !== "Cancelled";
    })
    .sort(
      (a, b) =>
        getMillis(a.startTime || a.StartDateTime || a.date) -
        getMillis(b.startTime || b.StartDateTime || b.date),
    );

  /**
   * One unbroken timeline for the whole day — no AM/PM shift break. The grid
   * defaults to 5:30 → 20:00 and stretches to include any booking outside it.
   */
  const timelineSlots = React.useMemo(() => {
    let startMin = DEFAULT_START_MIN;
    let endMin = DEFAULT_END_MIN; // last row starts at 19:30, closing at 8 PM
    (todaysSchedules || []).forEach((s) => {
      const start = safeToDate(s.startTime || s.StartDateTime || s.date);
      if (!start) return;
      const startSlot =
        Math.floor(studioMinutes(start) / SLOT_MINUTES) * SLOT_MINUTES;
      if (startSlot < startMin) startMin = startSlot;
      const end = safeToDate(s.endTime || s.EndDateTime);
      const endMinutes = end
        ? studioMinutes(end)
        : studioMinutes(start) + SLOT_MINUTES;
      // The row that CONTAINS the end (an 8:00–9:00 session needs the 8:30 row).
      const lastSlot =
        Math.ceil(endMinutes / SLOT_MINUTES) * SLOT_MINUTES - SLOT_MINUTES;
      if (lastSlot > endMin) endMin = lastSlot;
    });
    const slots: number[] = [];
    for (let m = startMin; m <= endMin; m += SLOT_MINUTES) slots.push(m);
    return slots;
  }, [todaysSchedules]);

  const timelineStartMin = timelineSlots[0] ?? DEFAULT_START_MIN;

  const preBookedCount = todaysSchedules.filter(
    (s) => !s.clientName?.toLowerCase().includes("unavailab"),
  ).length;

  /**
   * Day carousel: today plus the next six days. Fifteen days needed a
   * horizontal scroll of its own and pushed the schedule down the screen;
   * seven fit without scrolling, which is what frees the row beside them for
   * the day's numbers. Anything further out is the Calendar tab's job.
   */
  const carouselDays = React.useMemo(() => {
    const days: Date[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let offset = 0; offset <= 6; offset++) {
      const d = new Date(base);
      d.setDate(base.getDate() + offset);
      days.push(d);
    }
    return days;
  }, []);

  // Keep the selected day in view when the strip has to scroll (iPad portrait).
  useEffect(() => {
    const container = carouselRef.current;
    const target = selectedDayRef.current;
    if (!container || !target) return;
    const left =
      target.offsetLeft - container.clientWidth / 2 + target.offsetWidth / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [selectedDate]);

  /**
   * "NOW" line, in pixels from the top of the grid. Only drawn when the
   * selected day is today (by the studio's clock) and the time falls inside
   * the rendered timeline.
   */
  const nowLineTop = (() => {
    if (calendarLabelKey(selectedDate) !== studioDateKey(currentTime))
      return null;
    const mins = studioMinutes(currentTime);
    const lastSlot = timelineSlots[timelineSlots.length - 1];
    if (lastSlot === undefined) return null;
    if (mins < timelineStartMin || mins > lastSlot + SLOT_MINUTES) return null;
    return HEADER_PX + ((mins - timelineStartMin) / SLOT_MINUTES) * ROW_PX;
  })();

  /**
   * STRICT resolution: a schedule block resolves to `clients/{mindbodyClientId}`
   * or to nothing.
   *
   * This used to fuzzy-match on the client's NAME — first the trainer's home
   * studio, then globally, then by copying a link from any past schedule row
   * with the same name. All three are gone. Under strict mode the schedule's
   * clientId IS the canonical document id, so a name match can only ever
   * disagree with it, and disagreeing means opening the wrong person's medical
   * record from the grid.
   *
   * A block that does not resolve stays greyed out as "Not synced" until the
   * next sync creates the client document. There is deliberately no manual
   * fallback: creating a profile by hand here is what produced duplicate
   * documents outside the canonical path.
   */
  const findClientForSession = (session: any): Client | null => {
    if (!session?.clientId) return null;
    const target = String(session.clientId).trim();
    if (!target) return null;
    return clients.find((c) => c.id && String(c.id).trim() === target) || null;
  };

  const hasUnassignedAnywhereInGrid =
    todaysSchedules.some(
      (s) =>
        !s.trainerName ||
        s.trainerName.toLowerCase().includes("select") ||
        s.trainerName === "",
    ) ||
    sessions.some(
      (s) =>
        s.status === "In-Progress" &&
        (s as any).isUnassigned &&
        isSessionValid(s),
    ); // check for active unassigned sessions

  const getClientSessions = (client: Client) => {
    const clientName = `${client.firstName} ${client.lastName}`;
    const next = schedules
      .filter((s) => {
        const d = safeToDate(s.startTime);
        return (
          (s.clientId === client.id ||
            s.clientName.toLowerCase() === clientName.toLowerCase()) &&
          d &&
          d > now &&
          s.status !== "Cancelled"
        );
      })
      .sort((a, b) => getMillis(a.startTime) - getMillis(b.startTime))[0];
    const last = sessions
      .filter((s) => s.clientId === client.id)
      .sort((a, b) => parseSessionDate(b.date) - parseSessionDate(a.date))[0];
    return { next, last };
  };

  const visibleTrainersList = React.useMemo(() => {
    const activeTrainers = sortedTrainers.filter((t) => {
      if (t.isVisibleOnCalendar === false) return false;

      const isAssigned =
        !activeStudioId ||
        t.primaryHomeStudioId === activeStudioId ||
        t.accessibleStudioIds?.includes(activeStudioId) ||
        t.activeGuestStudioIds?.includes(activeStudioId);
      if (isAssigned) return true;

      const hasSessionToday = todaysSchedules.some(
        (s) =>
          (!activeStudioId || !s.studioId || s.studioId === activeStudioId) &&
          s.trainerName &&
          t.fullName &&
          s.trainerName.toLowerCase() === t.fullName.toLowerCase(),
      );
      return hasSessionToday;
    });

    const missingTrainerNames = new Set<string>();
    todaysSchedules.forEach((s) => {
      if (activeStudioId && s.studioId && s.studioId !== activeStudioId) return;
      if (
        s.trainerName &&
        !s.trainerName.toLowerCase().includes("select") &&
        !s.trainerName.toLowerCase().includes("unavailab") &&
        !activeTrainers.some(
          (t) =>
            t.fullName &&
            t.fullName.toLowerCase() === s.trainerName.toLowerCase(),
        )
      ) {
        missingTrainerNames.add(s.trainerName);
      }
    });

    const extraTrainers = Array.from(missingTrainerNames).map((name) => ({
      id: `virtual-${name}`,
      fullName: name,
      firstName: name.split(" ")[0],
      lastName: name.split(" ").slice(1).join(" "),
      role: "Trainer" as const,
      color: "#0EA5E9",
      initials: name.substring(0, 2).toUpperCase(),
    }));

    const combined = [...activeTrainers, ...extraTrainers];

    const withSessions = combined.filter((t) =>
      todaysSchedules.some(
        (s) =>
          (!activeStudioId || !s.studioId || s.studioId === activeStudioId) &&
          s.trainerName &&
          t.fullName &&
          s.trainerName.toLowerCase() === t.fullName.toLowerCase() &&
          !s.clientName?.toLowerCase().includes("unavailab"),
      ),
    );
    const list = withSessions.length > 0 ? withSessions : activeTrainers;

    // Dynamic pinning: whoever is logged in reads their own column first.
    const meIdx = list.findIndex((t) => isSelfTrainer(t));
    if (meIdx > 0) {
      const me = list[meIdx];
      return [me, ...list.filter((_, i) => i !== meIdx)];
    }
    return list;
  }, [sortedTrainers, activeStudioId, todaysSchedules, authTrainer]);

  /* ------------------------------------------------------------------ *
   * The day at a glance.
   *
   * Four numbers, read left to right as a sentence: how much is booked,
   * how much is done, what else is owed, and what room is left. They sit
   * in the strip beside the day carousel rather than in a band of their
   * own — condensing the carousel to seven days freed the width, and the
   * schedule keeps every vertical pixel it had.
   * ------------------------------------------------------------------ */

  /** Open task rows for the SELECTED day, studio list + this trainer's own. */
  const { counts: taskCounts } = useStudioTasks(activeStudioId || null, {
    ownerId: auth.currentUser?.uid ?? null,
    dateKey: calendarLabelKey(selectedDate),
  });
  const openTaskCount = Math.max(0, taskCounts.total - taskCounts.done);


  return (
    <motion.div
      key="clients"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 text-foreground dark:text-white w-full overflow-hidden"
    >
      {/* Client search moved to the global header (AppContent → AppHeader.searchSlot).
          Manual client creation stays removed: profiles arrive via the Mindbody sync. */}

      <AnimatePresence>
        {/* Registration form removed for unified modal; only editing is kept here for now or until unified */}
        {editingClient && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-8"
          >
            <Card className="border-2 border-primary/20 shadow-2xl dark:shadow-none rounded-3xl overflow-hidden">
              <CardHeader>
                <CardTitle>Edit Client Profile</CardTitle>
                <CardDescription>
                  Updating information for {editingClient.firstName}
                </CardDescription>
              </CardHeader>
              <form onSubmit={onSubmit}>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label
                        htmlFor="firstName"
                        className="text-base font-bold"
                      >
                        First Name
                      </Label>
                      <Input
                        id="firstName"
                        placeholder="First Name"
                        value={formData.firstName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            firstName: e.target.value,
                          })
                        }
                        required
                        className="h-14 text-lg"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="lastName" className="text-base font-bold">
                        Last Name
                      </Label>
                      <Input
                        id="lastName"
                        placeholder="Last Name"
                        value={formData.lastName}
                        onChange={(e) =>
                          setFormData({ ...formData, lastName: e.target.value })
                        }
                        required
                        className="h-14 text-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label htmlFor="gender" className="text-base font-bold">
                        Gender
                      </Label>
                      <div className="flex gap-2">
                        {["Male", "Female", "Other"].map((g) => (
                          <Button
                            key={g}
                            type="button"
                            variant={
                              formData.gender === g ? "default" : "outline"
                            }
                            className="flex-1 h-12 font-bold"
                            onClick={() =>
                              setFormData({ ...formData, gender: g as any })
                            }
                          >
                            {g}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-base font-bold">Height</Label>
                      <div className="flex gap-3">
                        <div className="relative flex-1">
                          <Input
                            id="heightFeet"
                            type="number"
                            placeholder="Ft"
                            value={formData.heightFeet}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                heightFeet: e.target.value,
                              })
                            }
                            required
                            className="h-14 text-lg pr-8"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                            ft
                          </span>
                        </div>
                        <div className="relative flex-1">
                          <Input
                            id="heightInches"
                            type="number"
                            placeholder="In"
                            value={formData.heightInches}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                heightInches: e.target.value,
                              })
                            }
                            required
                            className="h-14 text-lg pr-8"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                            in
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="weight" className="text-base font-bold">
                        Weight (lbs)
                      </Label>
                      <Input
                        id="weight"
                        type="number"
                        placeholder="e.g. 185"
                        value={formData.weight}
                        onChange={(e) =>
                          setFormData({ ...formData, weight: e.target.value })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="age" className="text-base font-bold">
                        Age
                      </Label>
                      <Input
                        id="age"
                        type="number"
                        placeholder="Years"
                        value={formData.age}
                        onChange={(e) =>
                          setFormData({ ...formData, age: e.target.value })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label
                        htmlFor="occupation"
                        className="text-base font-bold"
                      >
                        Occupation
                      </Label>
                      <Input
                        id="occupation"
                        placeholder="e.g. Software Engineer"
                        value={formData.occupation}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            occupation: e.target.value,
                          })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label htmlFor="phone" className="text-base font-bold">
                        Phone Number
                      </Label>
                      <Input
                        id="phone"
                        placeholder="(555) 000-0000"
                        value={formData.phone}
                        onChange={(e) =>
                          setFormData({ ...formData, phone: e.target.value })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="email" className="text-base font-bold">
                        Email Address
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="client@example.com"
                        value={formData.email}
                        onChange={(e) =>
                          setFormData({ ...formData, email: e.target.value })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="address" className="text-base font-bold">
                      Address
                    </Label>
                    <Input
                      id="address"
                      placeholder="123 Main St, City, State, Zip"
                      value={formData.address}
                      onChange={(e) =>
                        setFormData({ ...formData, address: e.target.value })
                      }
                      className="h-14 text-lg"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label
                        htmlFor="emergencyName"
                        className="text-base font-bold"
                      >
                        Emergency Contact Name
                      </Label>
                      <Input
                        id="emergencyName"
                        placeholder="Full Name"
                        value={formData.emergencyContactName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            emergencyContactName: e.target.value,
                          })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label
                        htmlFor="emergencyPhone"
                        className="text-base font-bold"
                      >
                        Emergency Contact Phone
                      </Label>
                      <Input
                        id="emergencyPhone"
                        placeholder="(555) 000-0000"
                        value={formData.emergencyContactPhone}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            emergencyContactPhone: e.target.value,
                          })
                        }
                        className="h-14 text-lg"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label
                      htmlFor="legacy_id_c"
                      className="text-base font-bold text-amber-600"
                    >
                      Legacy FileMaker ID
                    </Label>
                    <Input
                      id="legacy_id_c"
                      placeholder="Fm-XXXXX"
                      value={formData.legacy_filemaker_id}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          legacy_filemaker_id: e.target.value,
                        })
                      }
                      className="h-14 text-lg border-amber-500/30 bg-amber-500/5 focus:ring-amber-500"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-2xl">
                    <div className="space-y-0.5">
                      <Label className="text-base font-bold">
                        Active Status
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Is this client currently training?
                      </p>
                    </div>
                    <Switch
                      checked={formData.isActive}
                      onCheckedChange={(v) =>
                        setFormData({ ...formData, isActive: v })
                      }
                    />
                  </div>

                  <div className="space-y-3">
                    <Label
                      htmlFor="medicalHistory"
                      className="text-base font-bold"
                    >
                      Medical History / Injuries
                    </Label>
                    <Textarea
                      id="medicalHistory"
                      placeholder="List any medical history, injuries, or contraindications..."
                      value={formData.medicalHistory}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          medicalHistory: e.target.value,
                        })
                      }
                      className="min-h-25 text-lg p-4"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="notes" className="text-base font-bold">
                      Session Preferences / Notes
                    </Label>
                    <Textarea
                      id="notes"
                      placeholder="Trainer notes about preferences, motivations, etc."
                      value={formData.globalNotes}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          globalNotes: e.target.value,
                        })
                      }
                      className="min-h-25 text-lg p-4"
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex gap-4">
                  <Button
                    type="submit"
                    className="flex-1 h-14 text-lg font-bold uppercase tracking-widest"
                  >
                    Update Profile
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingClient(null);
                    }}
                    className="h-14 px-8"
                  >
                    Cancel
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden w-full">
        {!searchTerm ? (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
            {/* Slim strip directly under the header: the day's two numbers +
                the seven-day carousel. Both share one row so the timeline
                keeps every vertical pixel it had.

                Two, not four, as of Sep 6. "Complete" restated a fraction of
                the Sessions count and read as a second booking figure at a
                glance, and "Open slots" answered a sales question ("can you
                fit me in?") on a screen a trainer opens to run their day -
                the number nobody acted on from here. What is left is the two
                a trainer is actually accountable for on the floor: how many
                sessions, how much still to do. */}
            <div className="shrink-0 flex items-center gap-3 md:gap-4 px-3 md:px-4 h-12 border-b border-slate-200 dark:border-slate-800">
              <div
                // Two tiles, not four (Sep 6). `grid-cols-2` rather than a
                // flex row: with equal columns the pair keeps a stable,
                // balanced width whether the numbers are 0 and 0 or 12 and
                // 137, where auto-sized flex items would jog sideways every
                // time a session completed.
                className="shrink-0 grid grid-cols-2 gap-px rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-800 h-9 min-w-[13rem] md:min-w-[15rem]"
                role="group"
                aria-label={`Day summary for ${selectedDate.toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}`}
              >
                <DayStat
                  value={preBookedCount}
                  label="Sessions"
                  icon={<CalendarCheck className="w-3.5 h-3.5" />}
                  tone="text-cyan-700 dark:text-cyan"
                  title="Sessions booked on this day"
                />
                <DayStat
                  value={openTaskCount}
                  label="To-do"
                  icon={<ListChecks className="w-3.5 h-3.5" />}
                  tone={
                    openTaskCount > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-slate-400 dark:text-slate-500"
                  }
                  title="Studio and personal tasks still open for this day"
                />
              </div>

              <span className="hidden lg:block text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                {selectedDate.toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </span>

              <div
                ref={carouselRef}
                role="tablist"
                aria-label="Select day"
                className="ml-auto flex items-center gap-1 overflow-x-auto no-scrollbar snap-x snap-mandatory min-w-0 touch-pan-x overscroll-x-contain"
              >
                {carouselDays.map((date) => {
                  const key = calendarLabelKey(date);
                  const isSelected = key === calendarLabelKey(selectedDate);
                  const isToday = key === calendarLabelKey(new Date());
                  const isSunday = date.getDay() === 0;
                  return (
                    <button
                      key={key}
                      ref={isSelected ? selectedDayRef : undefined}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => setSelectedDate(date)}
                      className={cn(
                        "snap-start shrink-0 w-11 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors select-none cursor-pointer",
                        isSelected
                          ? "bg-cyan text-slate-900 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                          : isToday
                            ? "bg-slate-200/70 dark:bg-slate-800/70 text-foreground dark:text-white ring-1 ring-cyan/50"
                            : isSunday
                              ? "text-slate-400 dark:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-800/60"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60",
                      )}
                    >
                      <span className="text-[10px] font-bold uppercase leading-none opacity-80">
                        {date.toLocaleDateString([], { weekday: "narrow" })}
                      </span>
                      <span className="text-sm font-black leading-none tabular-nums">
                        {date.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Continuous timeline. This element is the ONLY scroller (both axes),
                which is what lets the trainer header and the time axis stick. */}
            <div className="flex-1 min-h-0 overflow-auto relative">
              <div
                className="relative"
                style={{
                  minWidth:
                    TIME_AXIS_PX +
                    Math.max(1, visibleTrainersList.length) * MIN_COLUMN_PX,
                }}
              >
                {nowLineTop !== null && (
                  <div
                    className="absolute left-0 right-0 h-px bg-linear-to-r from-orange-500 via-orange-500/70 to-transparent z-30 pointer-events-none"
                    style={{ top: nowLineTop }}
                  >
                    <div className="absolute left-0 -top-2 bg-orange-500 text-white text-[10px] font-black uppercase px-1.5 py-0.5 rounded-r-full flex items-center gap-1 leading-none">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      Now
                    </div>
                  </div>
                )}

                <table className="w-full border-separate border-spacing-0 table-fixed">
                  <colgroup>
                    <col style={{ width: TIME_AXIS_PX }} />
                    {visibleTrainersList.length === 0 && <col />}
                    {visibleTrainersList.map((t) => (
                      <col key={t.id} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="h-16">
                      {/* Corner cell: sticks to the top AND the left. */}
                      <th className="sticky top-0 left-0 z-40 bg-slate-100 dark:bg-slate-900 border-b border-r border-slate-200 dark:border-slate-800" />
                      {visibleTrainersList.length === 0 && (
                        <th className="sticky top-0 z-30 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                          No trainers scheduled
                        </th>
                      )}
                      {visibleTrainersList.map((trainer) => {
                        const isMe = isSelfTrainer(trainer);
                        const sessionCount = todaysSchedules.filter((s) => {
                          if (!isTrainerMatch(s, trainer)) return false;
                          if (s.clientName?.toLowerCase().includes("unavailab"))
                            return false;
                          return s.status !== "Cancelled";
                        }).length;
                        return (
                          <th
                            key={trainer.id}
                            className={cn(
                              "sticky top-0 z-30 border-b border-r last:border-r-0 border-slate-200 dark:border-slate-800 px-2 text-left font-normal",
                              // Sticky cells must be opaque or the grid shows through.
                              isMe
                                ? "bg-slate-200 dark:bg-slate-800"
                                : "bg-slate-100 dark:bg-slate-900",
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-black uppercase tracking-wider",
                                  isMe
                                    ? "bg-cyan text-slate-900"
                                    : "bg-primary text-primary-foreground",
                                )}
                              >
                                {(trainer.initials || trainer.fullName || "??")
                                  .substring(0, 2)}
                              </div>
                              <div className="min-w-0 leading-tight">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-[13px] font-black uppercase tracking-wider text-foreground dark:text-white truncate">
                                    {trainer.fullName.split(" ")[0]}
                                  </span>
                                  {isMe && (
                                    <span className="text-[9px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan shrink-0">
                                      You
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 tabular-nums">
                                  {sessionCount}{" "}
                                  {sessionCount === 1 ? "session" : "sessions"}
                                </span>
                              </div>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const skippedGridCells = new Set<string>();
                      return timelineSlots.map((slot, sIdx) => {
                        const isHour = slot % 60 === 0;
                        // The first row always gets a label, even at :30.
                        const showLabel = isHour || sIdx === 0;
                        return (
                          <tr key={slot} className="h-14">
                            {/* Time axis: label on the hour, quiet on the half hour. */}
                            <td
                              className={cn(
                                "sticky left-0 z-20 bg-slate-100 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 align-top px-1 pt-1 text-right",
                                isHour
                                  ? "border-b border-slate-200/70 dark:border-slate-800/70"
                                  : "border-b border-slate-300 dark:border-slate-700",
                              )}
                            >
                              {showLabel && (
                                <span className="text-[11px] font-bold tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                  {hourLabel(slot)}
                                </span>
                              )}
                            </td>
                            {visibleTrainersList.length === 0 && (
                              <td
                                className={cn(
                                  "border-b",
                                  isHour
                                    ? "border-slate-200/70 dark:border-slate-800/70"
                                    : "border-slate-300 dark:border-slate-700",
                                )}
                              />
                            )}
                            {visibleTrainersList.map((trainer) => {
                              const cellId = `${trainer.id}-${slot}`;
                              if (skippedGridCells.has(cellId)) return null;
                              const isMe = isSelfTrainer(trainer);

                              const cellSessions = todaysSchedules.filter(
                                (s) =>
                                  isTrainerMatch(s, trainer) &&
                                  slotOf(s) === slot &&
                                  s.status !== "Cancelled",
                              );

                              // A 60-minute booking spans two 30-minute rows.
                              let rowSpan = 1;
                              if (cellSessions.length === 1) {
                                const session = cellSessions[0];
                                const start = safeToDate(
                                  session.startTime ||
                                    session.StartDateTime ||
                                    session.date,
                                );
                                const end = safeToDate(
                                  session.endTime || session.EndDateTime,
                                );
                                if (start && end) {
                                  const duration =
                                    (end.getTime() - start.getTime()) /
                                    (1000 * 60);
                                  rowSpan = Math.max(
                                    1,
                                    Math.round(duration / SLOT_MINUTES),
                                  );
                                  // Never span over a row that holds another
                                  // booking for this trainer — that would hide it.
                                  for (let i = 1; i < rowSpan; i++) {
                                    const laterSlot = timelineSlots[sIdx + i];
                                    if (laterSlot === undefined) {
                                      rowSpan = i;
                                      break;
                                    }
                                    const collides = todaysSchedules.some(
                                      (s) =>
                                        isTrainerMatch(s, trainer) &&
                                        slotOf(s) === laterSlot &&
                                        s.status !== "Cancelled",
                                    );
                                    if (collides) {
                                      rowSpan = i;
                                      break;
                                    }
                                  }
                                  for (let i = 1; i < rowSpan; i++) {
                                    skippedGridCells.add(
                                      `${trainer.id}-${timelineSlots[sIdx + i]}`,
                                    );
                                  }
                                }
                              }

                              // The last spanned row decides the bottom border weight.
                              const lastSlot = timelineSlots[sIdx + rowSpan - 1];
                              const endsOnHour =
                                lastSlot !== undefined && lastSlot % 60 === 0;

                              return (
                                <td
                                  key={cellId}
                                  rowSpan={rowSpan}
                                  className={cn(
                                    "p-0.5 border-r last:border-r-0 border-slate-200 dark:border-slate-800 align-top",
                                    endsOnHour
                                      ? "border-b border-slate-200/70 dark:border-slate-800/70"
                                      : "border-b border-slate-300 dark:border-slate-700",
                                    isMe && "bg-slate-200/40 dark:bg-slate-800/50",
                                  )}
                                >
                                  {cellSessions.length > 0 && (
                                    // Explicit height keeps every row exactly ROW_PX
                                    // tall, so the NOW line and rowSpans line up.
                                    <div
                                      className="flex flex-col gap-0.5 w-full overflow-hidden"
                                      style={{ height: rowSpan * ROW_PX - 5 }}
                                    >
                                      {cellSessions.map((session, i) => {
                                        const clientObj =
                                          findClientForSession(session);
                                        const workoutSession = clientObj
                                          ? sessions.find(
                                              (s) =>
                                                s.clientId === clientObj.id &&
                                                new Date(
                                                  s.createdAt?.toDate?.() ||
                                                    s.date,
                                                ).toDateString() ===
                                                  new Date().toDateString(),
                                            )
                                          : null;
                                        return (
                                          <ScheduleBlock
                                            key={
                                              session.id ||
                                              session.mindbodyAppointmentId ||
                                              i
                                            }
                                            session={session}
                                            client={clientObj}
                                            workoutSession={workoutSession}
                                            onOpenClient={(clientId) => {
                                              onSelectClient(clientId);
                                              setView("profile");
                                            }}
                                          />
                                        );
                                      })}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 dark:bg-slate-950 p-6">
            <div className="flex items-center gap-3 mb-8">
              {isSearchingDb ? (
                <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
              ) : (
                <Search className="w-6 h-6 text-sky-500" />
              )}
              <h3 className="text-xl font-black uppercase tracking-widest text-foreground dark:text-white">
                Client Directory{" "}
                <span className="text-slate-500 dark:text-slate-400 ml-2">
                  ({mergedSearchClients.length})
                </span>
              </h3>
            </div>
            <div className="space-y-4 max-w-5xl">
              {mergedSearchClients.map((client) => {
                const { next, last } = getClientSessions(client);
                const clientName = `${client.firstName} ${client.lastName}`;

                return (
                  <motion.div
                    key={client.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <Card className="group hover:border-primary/50 transition-all cursor-pointer overflow-hidden rounded-3xl">
                      <CardContent className="p-0">
                        <div className="flex flex-col lg:flex-row p-6 gap-6">
                          <div
                            className="flex flex-col gap-2 cursor-pointer grow min-w-50"
                            onClick={() => {
                              onSelectClient(client.id!);
                              setView("profile");
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <h3 className="text-2xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                                {clientName}
                              </h3>
                              {client.isActive ? (
                                <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-none font-black text-[11px] uppercase">
                                  Active
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="font-black text-[11px] uppercase"
                                >
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            <div className="flex gap-4 text-[11px] font-bold text-muted-foreground uppercase">
                              <span>{client.height}</span>
                              <span>•</span>
                              <span>{client.weight || "--"} LBS</span>
                              <span>•</span>
                              <span className="text-primary">
                                {client.remainingSessions} SESSIONS
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 grow-2">
                            {/* Last Session Info */}
                            <div className="bg-white dark:bg-bg-dark p-4 rounded-2xl border border-border/50 flex flex-col justify-between">
                              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                                Previous Session
                              </p>
                              {last ? (
                                <div className="space-y-1">
                                  <p className="text-sm font-black">
                                    {new Date(last.date).toLocaleDateString(
                                      [],
                                      {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                      },
                                    )}
                                  </p>
                                  <p className="text-[11px] font-bold text-muted-foreground uppercase italic">
                                    TR: {last.trainerInitials}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs font-bold text-muted-foreground/30 uppercase italic">
                                  No history
                                </p>
                              )}
                            </div>

                            {/* Next Session Info */}
                            <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10 flex flex-col justify-between">
                              <p className="text-[11px] font-black uppercase tracking-widest text-primary mb-1">
                                Next Scheduled
                              </p>
                              {next ? (
                                <div className="space-y-1">
                                  <p className="text-sm font-black text-primary">
                                    {safeToDate(
                                      next.startTime,
                                    )?.toLocaleDateString([], {
                                      month: "short",
                                      day: "numeric",
                                    })}{" "}
                                    @{" "}
                                    {safeToDate(
                                      next.startTime,
                                    )?.toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </p>
                                  <p className="text-[11px] font-black text-primary/70 uppercase italic">
                                    TR: {next.trainerName}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs font-bold text-muted-foreground/30 uppercase italic">
                                  Not scheduled
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              className="h-20 w-20 rounded-2xl font-black flex flex-col gap-1 border-2 shadow-sm dark:shadow-none uppercase group-hover:border-primary/20"
                              onClick={() => {
                                setSelectedSessionId(null);
                                onSelectClient(client.id!);
                                setView("history");
                              }}
                            >
                              <History className="w-6 h-6" />
                              <span className="text-[11px]">History</span>
                            </Button>
                            <Button
                              className="h-20 w-20 rounded-2xl font-black flex flex-col gap-1 shadow-lg shadow-primary/20 uppercase"
                              onClick={() => {
                                onSelectClient(client.id!);
                                setView("workouts");
                              }}
                            >
                              <Play className="w-6 h-6 fill-current" />
                              <span className="text-[11px]">Start</span>
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
              {mergedSearchClients.length === 0 && !isSearchingDb && (
                <div className="py-20 text-center border-2 border-dashed rounded-3xl bg-muted/10 opacity-50">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-xs font-black uppercase">
                    No client matches "{searchTerm}"
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </motion.div>
  );
}
