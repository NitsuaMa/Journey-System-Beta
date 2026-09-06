/**
 * PROFILE HEADER — identity, four headline facts, one loud action.
 *
 * Row 1  ‹ avatar  NAME                                   [▶ START SESSION]
 *        ▪▪▪ studio · client since · flags
 * Row 2  Top trainer │ Last session │ Next session │ Sessions completed · package
 *
 * Decisions (Sep 5 2026 round):
 *  - Top trainer is READ from the persisted tally (useTopTrainer), not
 *    counted from whatever page of history happens to be loaded.
 *  - "Sessions completed" lost its "/ 46 total" tail. The package sits
 *    beside it instead, in Mindbody blue when Mindbody supplied it.
 *  - Next session shows the weekday and the time — "see you Tuesday at
 *    two" is the sentence this tile exists to support.
 *  - Profile Details moved into the tab row; the header keeps exactly one
 *    button, so the eye has nowhere to go but Start Session.
 */
import type { ReactNode } from "react";
import { CalendarDays, ChevronLeft, Clock, History, Maximize, Play, Trash2, UserCheck, AlertTriangle, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn, parseSessionDate } from "../../lib/utils";
import { formatStudioTime, toDate, zonedYMD } from "../../lib/studio-time";
import type { Client, ScheduleEntry, WorkoutSession } from "../../types";
import type { PackageSummary } from "./client-package";
import { remainingLabel } from "./client-package";
import type { TopTrainerState } from "./useTopTrainer";
import { BrandTiles } from "./BrandTiles";

export interface ActiveSessionLike {
  id?: string;
  trainerInitials?: string;
  startTime?: { toMillis?: () => number } | null;
}

/**
 * The Kaizen Roster toggle, passed in rather than wired here.
 *
 * Absent when there is no signed-in trainer to own a roster. The header stays
 * dumb: ClientProfileView owns the mutation, this owns the pixel.
 */
export interface KaizenToggleState {
  isOn: boolean;
  busy?: boolean;
  onToggle: () => void;
}

export interface ProfileHeaderProps {
  client: Client;
  studioName?: string | null;
  sessions: WorkoutSession[];
  scheduledSessions: ScheduleEntry[];
  completedCount: number;
  topTrainer: TopTrainerState;
  pkg: PackageSummary;
  activeInProgressSession?: ActiveSessionLike | null;
  isCheckingActiveSession?: boolean;
  onBack: () => void;
  onStartSession: () => void;
  onTakeOverSession: () => void;
  onViewCurrentSession: () => void;
  onDiscardSession: () => void;
  kaizen?: KaizenToggleState;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function relativeDays(ms: number): string | null {
  if (!ms) return null;
  const days = Math.round((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  return `${Math.round(days / 30)} mo ago`;
}

function daysUntil(d: Date): string | null {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return null;
}

function clientSince(client: Client): string | null {
  const d = toDate(client.firstSessionDate) || toDate(client.firstAppointmentDate) || toDate(client.mindbodyCreatedAt) || toDate(client.createdAt);
  if (!d) return null;
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ------------------------------------------------------------------ */

function Stat({
  label,
  icon,
  children,
  sub,
  meter,
  className,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  /**
   * Optional fuel gauge drawn on the tile's bottom edge. Absolute, so a
   * ratio becomes readable at a glance without costing the header a single
   * pixel of height — which the Journey grid below spends on machines.
   */
  meter?: { value: number; max: number; label?: string };
  className?: string;
}) {
  const pct =
    meter && meter.max > 0
      ? Math.max(0, Math.min(100, (meter.value / meter.max) * 100))
      : null;
  return (
    <div
      className={cn(
        "relative min-w-0 bg-white dark:bg-slate-950 px-3 xl:px-2.5 py-2 flex flex-col justify-center gap-0.5",
        pct !== null && "pb-2.5",
        className,
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 leading-none">{label}</span>
      <span className="flex items-center gap-2 min-w-0 text-[15px] font-bold leading-tight text-slate-900 dark:text-slate-50">
        {icon && <span className="shrink-0 text-slate-400 dark:text-slate-500 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
        <span className="min-w-0 flex items-center gap-2 [&>.truncate]:min-w-0">{children}</span>
      </span>
      {sub && <span className="text-[11px] font-medium leading-none text-slate-500 dark:text-slate-400 min-w-0 flex items-center [&>*]:min-w-0 [&>span:not(.inline-flex)]:truncate">{sub}</span>}
      {pct !== null && (
        <span
          className="absolute inset-x-0 bottom-0 h-1 bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
          role="img"
          aria-label={meter!.label ?? `${meter!.value} of ${meter!.max}`}
        >
          <span
            className="block h-full bg-[#F06C22] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ProfileHeader({
  client,
  studioName,
  sessions,
  scheduledSessions,
  completedCount,
  topTrainer,
  pkg,
  activeInProgressSession,
  isCheckingActiveSession = false,
  onBack,
  onStartSession,
  onTakeOverSession,
  onViewCurrentSession,
  onDiscardSession,
  kaizen,
}: ProfileHeaderProps) {
  /* ---- last session ---- */
  const last = sessions.find((s) => s.status === "Completed") ?? sessions[0];
  const lastMs = last?.date ? parseSessionDate(last.date) : 0;
  const lastLabel = lastMs ? new Date(lastMs).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : null;

  /* ---- next session ---- */
  const next = scheduledSessions[0];
  const nextDate = next ? toDate(next.startTime) : null;
  const nextTime = nextDate ? formatStudioTime(nextDate, undefined, "") : "";
  /**
   * "Tuesday 12:30 PM". The month was noise — a next session is days away,
   * never months, and "see you Tuesday at half twelve" is the sentence this
   * tile exists to support. Inside two days the weekday gives way to the
   * word a trainer would actually say.
   */
  // The weekday is read on the STUDIO's clock, like the time printed beside
  // it. `getDay()` reads the viewer's, so a late-evening session opened from
  // a browser a few hours off Eastern showed the wrong weekday next to the
  // right time — exactly the hazard lib/studio-time exists to prevent.
  const nextYMD = nextDate ? zonedYMD(nextDate) : null;
  const nextWeekday =
    nextYMD !== null
      ? WEEKDAYS_LONG[new Date(Date.UTC(nextYMD.year, nextYMD.month - 1, nextYMD.day)).getUTCDay()]
      : null;
  const nextDay = nextDate
    ? daysUntil(nextDate) === "today"
      ? "Today"
      : daysUntil(nextDate) === "tomorrow"
        ? "Tomorrow"
        : nextWeekday
    : null;
  const nextLabel = nextDay ? `${nextDay}${nextTime ? ` ${nextTime}` : ""}` : null;
  const moreBooked = Math.max(0, scheduledSessions.length - 1);

  /* ---- package ---- */
  const remaining = remainingLabel(pkg);
  const since = clientSince(client);
  const hasFlags = !!(client.notes || (client.clinicalFlags && client.clinicalFlags.length > 0));
  const initials = `${(client.firstName || "").charAt(0)}${(client.lastName || "").charAt(0)}`.toUpperCase();

  return (
    <header
      className={cn(
        "bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800/60 pb-2.5 mb-3 pt-1",
        // Portrait (a 13" iPad is 1024px — Tailwind's lg): identity + action on
        // row one, the four facts on row two. Landscape (1366px — xl): one
        // band — identity, facts, action — which hands the Journey grid ~90px
        // more height, the difference between 19 and 21 machines on screen.
        // The identity block gives up its sub-line details until 2xl so the
        // four tiles keep ~180px each.
        "grid gap-x-3 xl:gap-x-4 gap-y-3 items-center",
        "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'id_cta'_'strip_strip']",
        "xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:[grid-template-areas:'id_strip_cta']",
      )}
    >
      {/* ---------- identity ---------- */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 [grid-area:id]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to clients"
          className="shrink-0 h-10 w-10 rounded-full grid place-items-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <Avatar size="xl" className="ring-2 ring-slate-200 dark:ring-slate-800 bg-slate-100 dark:bg-slate-800 shrink-0 xl:size-12 2xl:size-14">
          {client.photoUrl && <AvatarImage src={client.photoUrl} alt={`${client.firstName} ${client.lastName}`} />}
          <AvatarFallback className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-lg">
            {initials || <User className="w-7 h-7" />}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 xl:max-w-[240px] 2xl:max-w-[320px]">
          <h1 className="text-2xl md:text-[26px] xl:text-[28px] font-black tracking-tight leading-none text-slate-900 dark:text-white truncate">
            {client.firstName} {client.lastName}
          </h1>
          <div className="mt-1.5 flex items-center gap-2.5 min-w-0">
            <BrandTiles size={6} gap={2} />
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 truncate">
              <span>{studioName}</span>
              {since && <span className="xl:hidden 2xl:inline">{studioName ? "  ·  " : ""}Client since {since}</span>}
              {(client.experienceLevel || client.trainingPedigree) && (
                <span className="xl:hidden 2xl:inline">  ·  {client.experienceLevel || client.trainingPedigree}</span>
              )}
            </span>
            {hasFlags && (
              <span className="hidden sm:inline-flex xl:hidden 2xl:inline-flex items-center gap-1.5 rounded px-2 py-0.5 border border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-3 h-3" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Clinical notes</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ---------- the action. Hero orange appears nowhere else in the header. ---------- */}
      <div className="[grid-area:cta] justify-self-end flex items-center gap-2">
        {/*
          Kaizen Roster toggle. Deliberately quiet and deliberately BLUE: the
          red kaizen mark means "this rep needs work" in the session grid, and
          if the two ever share a colour a glance can no longer tell "I am
          tracking you" from "you are doing it wrong". It also stays visually
          subordinate to Start Session, which is the one loud thing here.
        */}
        {kaizen && (
          <button
            type="button"
            onClick={kaizen.onToggle}
            disabled={kaizen.busy}
            aria-pressed={kaizen.isOn}
            title={kaizen.isOn ? "On your Kaizen Roster — tap to remove" : "Add to your Kaizen Roster"}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 h-12 px-3 rounded-2xl border text-[11px] font-bold uppercase tracking-widest transition-colors",
              kaizen.busy && "opacity-50",
              kaizen.isOn
                ? "border-transparent bg-[#0a548b]/10 text-[#034a84] dark:bg-[#4a9fd8]/15 dark:text-[#7cc0ee]"
                : "border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-[#034a84] dark:hover:text-[#7cc0ee]",
            )}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="2,10 6,6 10,10" opacity={0.55} />
              <polyline points="6,13 10,9 14,13" />
            </svg>
            <span className="hidden sm:inline">{kaizen.isOn ? "Tracking" : "Track"}</span>
          </button>
        )}
        {activeInProgressSession ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 h-12 px-4 sm:px-5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-display italic uppercase tracking-wider text-sm sm:text-base shadow-[0_10px_30px_-12px_rgba(245,158,11,.8)] transition-colors">
              <Clock className="w-4 h-4 animate-pulse" />
              <span className="hidden sm:inline">In progress</span>
              <span className="text-white/80 text-xs not-italic font-sans font-bold">({activeInProgressSession.trainerInitials})</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-2xl p-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <div className="px-3 py-2 mb-2 border-b border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-medium uppercase text-amber-500 tracking-widest">Active session detected</p>
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 mt-1">
                  Started by {activeInProgressSession.trainerInitials} at{" "}
                  {new Date(activeInProgressSession.startTime?.toMillis?.() || 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <DropdownMenuItem onClick={onTakeOverSession} className="rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/20 cursor-pointer flex items-center gap-2 p-3 text-amber-700 dark:text-amber-500">
                <Play className="w-4 h-4" />
                <span className="font-bold uppercase text-xs">Take over session</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onViewCurrentSession} className="rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-2 p-3 text-slate-700 dark:text-slate-300">
                <Maximize className="w-4 h-4" />
                <span className="font-bold uppercase text-xs">View current session</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDiscardSession} className="rounded-xl hover:bg-red-50 dark:hover:bg-red-500/20 cursor-pointer flex items-center gap-2 p-3 text-red-600 dark:text-red-500">
                <Trash2 className="w-4 h-4" />
                <span className="font-bold uppercase text-xs">Discard session</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={onStartSession}
            disabled={isCheckingActiveSession}
            className={cn(
              "group relative shrink-0 inline-flex items-center gap-3 h-12 xl:h-[52px] pl-1.5 pr-3 sm:pr-5 rounded-2xl text-white",
              "bg-[linear-gradient(135deg,#ef5302_0%,#f36d21_100%)] ring-1 ring-white/25 ring-inset",
              "shadow-[0_14px_34px_-14px_rgba(239,83,2,.85)] hover:shadow-[0_18px_40px_-14px_rgba(239,83,2,.95)] hover:brightness-[1.04]",
              "active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-wait",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0a548b]",
            )}
          >
            <span className="grid place-items-center w-9 h-9 xl:w-10 xl:h-10 rounded-xl bg-white/20 group-hover:bg-white/25 transition-colors">
              <Play className="w-4 h-4 xl:w-[18px] xl:h-[18px] fill-current translate-x-px" />
            </span>
            <span className="hidden sm:flex flex-col items-start leading-none">
              <span className="font-display italic uppercase tracking-wider text-base xl:text-lg">
                {isCheckingActiveSession ? "Checking…" : "Start session"}
              </span>
              {!isCheckingActiveSession && nextDate && daysUntil(nextDate) === "today" && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/85 mt-1">Booked today{nextTime ? ` · ${nextTime}` : ""}</span>
              )}
            </span>
          </button>
        )}
      </div>

      {/* ---------- the four facts, hairline-divided ---------- */}
      <div className="[grid-area:strip] min-w-0 grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
        <Stat
          label="Top trainer"
          icon={<UserCheck />}
          sub={
            topTrainer.top
              ? topTrainer.source === "tally"
                ? `${topTrainer.top.sessions} of ${topTrainer.top.total} sessions`
                : topTrainer.backfilling
                  ? "Counting full history…"
                  : "From recent sessions"
              : undefined
          }
        >
          {topTrainer.top?.name ? <span className="truncate">{topTrainer.top.name}</span> : <span className="text-slate-400 font-medium">Not yet</span>}
        </Stat>

        <Stat label="Last session" icon={<History />} sub={lastMs ? relativeDays(lastMs) ?? undefined : undefined}>
          {lastLabel ?? <span className="text-slate-400 font-medium">No sessions yet</span>}
        </Stat>

        <Stat
          label="Next session"
          icon={<CalendarDays />}
          sub={
            nextDate && daysUntil(nextDate) && nextDay !== "Today" && nextDay !== "Tomorrow" ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-slate-400">{daysUntil(nextDate)}</span>
              </span>
            ) : nextDate ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-slate-400">{MONTHS[nextDate.getMonth()]} {nextDate.getDate()}</span>
              </span>
            ) : undefined
          }
        >
          {nextLabel ? (
            <>
              <span className="truncate">{nextLabel}</span>
              {moreBooked > 0 && (
                <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 tracking-wide whitespace-nowrap">
                  +{moreBooked}
                  <span className="xl:hidden 2xl:inline"> booked</span>
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-400 font-medium italic">Not scheduled</span>
          )}
        </Stat>

        {/* Marker 6: the package used to be "46" shouting next to "of 96 in
            package" whispering, so the ratio never registered. Now the two
            numbers are one fraction at comparable weight, and the tile's
            bottom edge carries a gauge — how much of the package is spent
            is legible without reading a digit. */}
        <Stat
          label="Completed sessions"
          meter={
            pkg.total && pkg.total > 0
              ? {
                  value: Math.min(completedCount, pkg.total),
                  max: pkg.total,
                  label: `${completedCount} of ${pkg.total} sessions in this package used`,
                }
              : undefined
          }
          sub={
            pkg.source === "none" ? undefined : (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider min-w-0 max-w-full",
                  pkg.fromMindbody
                    ? "bg-[#0a548b]/10 text-[#0a548b] dark:bg-[#5198d8]/15 dark:text-[#8cc4f2]"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                )}
                title={pkg.fromMindbody ? "Synced from Mindbody" : "Entered in this app"}
              >
                {pkg.fromMindbody && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80 shrink-0" aria-hidden="true" />}
                {/* Count first: when the tile is narrow the package NAME is what truncates. */}
                <span className="truncate">{[remaining, pkg.label].filter(Boolean).join(" · ")}</span>
              </span>
            )
          }
        >
          <span className="text-2xl font-black leading-none text-[#F06C22] tabular-nums">{completedCount}</span>
          {!!pkg.total && pkg.total > 0 && (
            <span className="shrink-0 flex items-baseline gap-1 leading-none">
              <span className="text-lg font-black text-slate-300 dark:text-slate-700" aria-hidden="true">
                /
              </span>
              <span className="text-lg font-black tabular-nums text-slate-700 dark:text-slate-200">{pkg.total}</span>
            </span>
          )}
        </Stat>
      </div>
    </header>
  );
}
