/**
 * THE PRE-SESSION BRIEFING.
 *
 * Round: Sep 6 2026 UI pass. Originally built Aug 2026.
 *
 * The last screen before a trainer puts hands on a client, and the only one
 * that answers "is there anything here that could hurt them". Everything on it
 * is ordered by that: who they are, what must not happen, what the plan is,
 * how they turned up today, and then one loud way to start.
 *
 * WHAT THIS ROUND CHANGED, AND WHY
 * --------------------------------
 * Style: it now uses the feature-token pattern the rest of the app moved to -
 * briefing.tokens.css for colour, briefing.css for layout, and class names in
 * the markup. It used to be raw utilities, and that had cost real things:
 * #38BDF8 and #0A548B were typed in by hand rather than named, dark-mode pairs
 * existed on some elements and not others, five different corner radii were in
 * play, and the four check-in pill groups were 120 lines of copy-pasted class
 * strings that had already drifted apart from one another.
 *
 * Order: the critical strip moved ABOVE the goal. A goal is a direction; a
 * contraindication is a thing that must not happen in the next ninety minutes,
 * and it was reading second.
 *
 * Scrolling: the screen no longer declares `min-h-screen` and its own
 * `overflow-y-auto` inside AppContent's <main>, which already scrolls for this
 * view. See the header of briefing.css - that pair is why START SESSION sat
 * under the bottom nav.
 *
 * Restored: the BodyStateTracker. It was imported, never rendered, and the
 * `bodyStates` state plus the branch in handleStart that saves it into
 * PreSessionCheckIn were therefore dead. The element was the only missing
 * piece; everything downstream of it already worked.
 */

import React, { useState, useEffect } from "react";
import {
  Activity,
  ArrowUpDown,
  Check,
  GripVertical,
  HeartPulse,
  Info,
  Lightbulb,
  Play,
  Plus,
  Target,
  X,
} from "lucide-react";
import { ConditionChip } from "../../components/ConditionChip";
import { RoutineCompareCard } from "../../components/RoutineCompareCard";
import { SequenceRow } from "../../components/SequenceRow";
import { cn } from "@/lib/utils";
import {
  findRoutineByLetter,
  matchesRoutineLetter,
} from "../../lib/routine-utils";
import { AppHeader } from "../../components/AppHeader";
import { useTheme } from "../../components/ThemeProvider";
import {
  Machine,
  Routine,
  SessionNote,
  Trainer,
  Client,
  WorkoutSession,
  TrainerFocus,
  FocusRecord,
  ExerciseLog,
  PreSessionCheckIn,
  SleepQuality,
  BodyStateTag,
} from "../../types";
import { BodyStateTracker } from "../../components/BodyStateTracker";
import { QuickCheckInDialog } from "../subjective-report";
import { useClientJournal } from "../../hooks/useClientJournal";
import { JournalEntryCard } from "../../components/journal/JournalEntryCard";
import { FOCUS_VISUALS, relativeDay, toDate } from "../../types/journal";
import { CLINICAL_FLAGS_MATRIX } from "../../data/clinical-matrix";
import { safeToDate } from "../../lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./briefing.css";

function SortableSequenceItem({
  id,
  children,
  showAddMachine,
  onRemove,
}: {
  key?: React.Key;
  id: string;
  children: React.ReactNode;
  showAddMachine: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="br__seq-item"
      data-dragging={isDragging || undefined}
    >
      {showAddMachine && (
        <div
          {...attributes}
          {...listeners}
          className="br__seq-handle"
          aria-label={`Reorder ${id}`}
        >
          <GripVertical className="w-5 h-5 pointer-events-none" />
        </div>
      )}
      {/* Inert on purpose: the row is a readout, and a stray tap on it during
          a drag would otherwise cancel the drag. */}
      <div className="br__seq-body" data-inert="true">
        {children}
      </div>
      {showAddMachine && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="br__seq-remove"
          aria-label="Remove from routine"
        >
          <X className="w-5 h-5 pointer-events-none" />
        </button>
      )}
    </div>
  );
}

/**
 * One row of mutually exclusive pills. Tapping the active one clears it.
 *
 * The check-in carried four of these written out longhand, each option
 * repeating the same twelve-class conditional string - roughly 120 lines of
 * markup for four questions, and the strings had already drifted apart from
 * each other. Selected state now hangs off `aria-pressed`, which these buttons
 * had to set for screen readers regardless, so the styling and the semantics
 * cannot disagree.
 */
function PillGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (next: T | undefined) => void;
}) {
  return (
    <fieldset className="br__field">
      <legend className="br__label">{label}</legend>
      <div className="br__pills">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              className="br__pill"
              aria-pressed={active}
              onClick={() => onChange(active ? undefined : opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface BriefingScreenProps {
  authTrainer: Trainer | null;
  client: Client;
  targetRoutine: Routine | null;
  lastSession: WorkoutSession | null;
  onStart: (
    routineType: "A" | "B" | "Free",
    customMachines?: string[],
    note?: string,
    checkIn?: PreSessionCheckIn,
  ) => void;
  onClose: () => void;
  machines: Machine[];
  routines: Routine[];
  trainerFocuses: TrainerFocus[];
  focusRecords?: FocusRecord[];
  sessionNotes: SessionNote[];
  /** Used to resolve initials on legacy journal rows. */
  trainers?: Trainer[];
  logs?: ExerciseLog[];
  isIntroSession?: boolean;
  rightControls?: React.ReactNode;
  trainerDropdown?: React.ReactNode;
  onStudioClick?: () => void;
}

export function BriefingScreen({
  authTrainer,
  client,
  targetRoutine,
  lastSession,
  onStart,
  onClose,
  machines,
  routines,
  trainerFocuses,
  focusRecords = [],
  sessionNotes,
  trainers = [],
  logs = [],
  isIntroSession = false,
  rightControls,
  trainerDropdown,
  onStudioClick,
}: BriefingScreenProps) {
  // The header follows the app theme now that the page below it does.
  // Mirrors AppContent's own call so the two can never disagree.
  const { theme } = useTheme();

  const [selectedRoutineType, setSelectedRoutineType] = useState<
    "A" | "B" | "Free" | "Create_A" | "Create_B"
  >("A");
  const [adjustedMachineIds, setAdjustedMachineIds] = useState<string[]>([]);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  /** The 90-day check-in, run here instead of inside a full progress report. */
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [sleepQuality, setSleepQuality] = useState<SleepQuality | undefined>(
    undefined,
  );
  const [stressLevel, setStressLevel] = useState<1 | 2 | 3 | 4 | 5 | undefined>(
    undefined,
  );
  const [bodyStates, setBodyStates] = useState<BodyStateTag[]>([]);
  // Energy + mood (Sep 2026): one tap each, optional, so the Clinical Review
  // can cross-reference how the client arrived with how the session went.
  const [energyLevel, setEnergyLevel] = useState<"low" | "normal" | "high" | undefined>(undefined);
  const [mood, setMood] = useState<"low" | "neutral" | "good" | undefined>(undefined);

  const routineA = findRoutineByLetter(routines, "A");
  const routineB = findRoutineByLetter(routines, "B");

  /** Set once the trainer picks a routine by hand, so a background refetch of
   *  `routines` cannot silently reset their choice back to the suggestion. */
  const [routinePickedByTrainer, setRoutinePickedByTrainer] = useState(false);

  /** Which routine the alternation logic proposed, shown as a hint on the toggle. */
  const suggestedType: "A" | "B" = matchesRoutineLetter(targetRoutine, "B")
    ? "B"
    : "A";

  const handlePickRoutine = (type: "A" | "B") => {
    setRoutinePickedByTrainer(true);
    setIsAdjusting(false);
    if (type === "A") {
      setSelectedRoutineType(routineA ? "A" : "Create_A");
      setAdjustedMachineIds(routineA?.machineIds || []);
    } else {
      setSelectedRoutineType(routineB ? "B" : "Create_B");
      setAdjustedMachineIds(routineB?.machineIds || []);
    }
  };

  useEffect(() => {
    if (isIntroSession) {
      const demoRoutine = routines.find((r) => r.name === "Demo Routine");
      if (
        demoRoutine &&
        demoRoutine.machineIds &&
        demoRoutine.machineIds.length > 0
      ) {
        setSelectedRoutineType(routineA ? "A" : "Create_A");
        setAdjustedMachineIds(demoRoutine.machineIds);
        setIsAdjusting(true);
        return;
      }
    }

    let type: "A" | "B" | "Free" | "Create_A" | "Create_B" = routineA ? "A" : "Create_A";
    if (targetRoutine) {
      if (matchesRoutineLetter(targetRoutine, "A")) type = routineA ? "A" : "Create_A";
      else if (matchesRoutineLetter(targetRoutine, "B")) type = routineB ? "B" : "Create_B";
    }

    if (type === "B" && !routineB) {
      type = "Create_B";
    }

    // A hand-picked routine wins over the suggestion.
    if (routinePickedByTrainer) return;

    setSelectedRoutineType(type);
    if (type === "B") {
      setAdjustedMachineIds(routineB?.machineIds || []);
    } else if (type === "A") {
      setAdjustedMachineIds(routineA?.machineIds || []);
    } else {
      setAdjustedMachineIds([]);
    }
  }, [targetRoutine, routineA, routineB, routinePickedByTrainer, isIntroSession, routines]);

  const getCurrentBaseSequence = () => {
    if (
      isAdjusting ||
      ["Free", "Create_A", "Create_B"].includes(selectedRoutineType)
    )
      return adjustedMachineIds;
    return selectedRoutineType === "A"
      ? routineA?.machineIds || []
      : routineB?.machineIds || [];
  };

  const removeMachine = (index: number) => {
    const currentItems = getCurrentBaseSequence();
    const newSequence = [...currentItems];
    newSequence.splice(index, 1);
    setAdjustedMachineIds(newSequence);
    setIsAdjusting(true);
  };

  const addMachine = (machineId: string) => {
    const currentItems = getCurrentBaseSequence();
    setAdjustedMachineIds([...currentItems, machineId]);
    setIsAdjusting(true);
    setShowAddMachine(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const currentItems = getCurrentBaseSequence();
      const oldIndex = currentItems.indexOf(active.id as string);
      const newIndex = currentItems.indexOf(over.id as string);
      const newSequence = arrayMove(currentItems, oldIndex, newIndex);
      setAdjustedMachineIds(newSequence);
      setIsAdjusting(true);
    }
  };

  const handleStart = () => {
    const checkIn: PreSessionCheckIn = {};
    if (sleepQuality) checkIn.sleepQuality = sleepQuality;
    if (stressLevel) checkIn.stressLevel = stressLevel;
    if (energyLevel) checkIn.energyLevel = energyLevel;
    if (mood) checkIn.mood = mood;
    if (bodyStates.length > 0) checkIn.bodyStates = bodyStates;

    onStart(
      selectedRoutineType === "Create_B"
        ? "B"
        : selectedRoutineType === "Create_A"
          ? "A"
          : (selectedRoutineType as any),
      isAdjusting ||
        ["Free", "Create_A", "Create_B"].includes(selectedRoutineType)
        ? adjustedMachineIds
        : undefined,
      adjustmentNote,
      checkIn,
    );
  };

  const clientFlags = (client.clinicalFlags || [])
    .map((flagId) => CLINICAL_FLAGS_MATRIX.find((f) => f.id === flagId))
    .filter(Boolean) as typeof CLINICAL_FLAGS_MATRIX;

  const severityOrder = {
    "Absolute Contraindication": 0,
    "High Risk": 1,
    "Moderate / Needs Modification": 2,
  };
  clientFlags.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  /**
   * The briefing and the Journal read the SAME selection, from the same hook,
   * so the two can never disagree about what a coach needs to know. Anything a
   * coach marks critical in the Journal shows up here automatically — including
   * unresolved incidents, post-op restrictions still inside their window, and
   * Mindbody-imported consultation notes flagged critical.
   *
   * The old code filtered sessionNotes for priority === "High"; those rows are
   * still covered, because the adapter maps High -> critical.
   */
  const { criticalEntries, focuses } = useClientJournal({
    clientId: client.id || null,
    client,
    trainers,
  });

  const activeJournalFocuses = focuses.filter((f) => f.status === "active");

  const lastRoutineName = lastSession
    ? routines.find((r) => r.id === lastSession.routineId)?.name ||
      ((lastSession.sessionType as string) === "Free"
        ? "Open Session"
        : lastSession.sessionType)
    : "None";

  const lastSessionDate = safeToDate(lastSession?.endTime)
    ? safeToDate(lastSession.endTime)!.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Never";

  // Follows the trainer's selection, not the original suggestion — otherwise the
  // card keeps naming the auto-picked routine after they switch.
  const isBSelected = ["B", "Create_B"].includes(selectedRoutineType);
  const scheduledRoutineName = isBSelected
    ? routineB?.name || "Routine B"
    : routineA?.name || "Routine A";



  const selectedRoutineIds =
    isAdjusting ||
    ["Free", "Create_A", "Create_B"].includes(selectedRoutineType)
      ? adjustedMachineIds
      : selectedRoutineType === "A"
        ? routineA?.machineIds || []
        : routineB?.machineIds || [];

  return (
    <div className="br">
        <AppHeader
          variant={theme === "light" ? "light" : "dark"}
          trainerInitials={authTrainer?.initials || "AJ"}
          rightControls={rightControls}
          trainerDropdown={trainerDropdown}
          onStudioClick={onStudioClick}
        />

        <div className="br__page">
            {/* 1. Who is in front of you, and what must not happen. */}
            <section className="br-card br__hero">
              <div className="br__hero-top">
                <div className="min-w-0">
                  <h1 className="br__name">
                    {client.firstName} {client.lastName}
                  </h1>
                  <p className="br__meta">
                    Last session · {lastSessionDate} · {lastRoutineName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="br__close"
                  aria-label="Close briefing"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {clientFlags.length > 0 && (
                <div className="br__flags">
                  {clientFlags.map((cond, i) => (
                    <ConditionChip
                      key={i}
                      label={cond.conditionName || (cond as any).label}
                      severity={
                        cond.severity === "High Risk" ||
                        cond.severity === "Absolute Contraindication"
                          ? "critical"
                          : "standard"
                      }
                    />
                  ))}
                </div>
              )}

              {/* ABOVE the goal, as of Sep 6. The same set the Journal pins to
                  its "Before you start" strip - unresolved incidents, post-op
                  restrictions still inside their window, imported consultation
                  notes flagged critical. A goal is a direction; this is a
                  thing that must not happen in the next ninety minutes, and it
                  was reading second. */}
              {criticalEntries.length > 0 && (
                <div className="br__critical">
                  <span className="br__label">
                    <Info className="w-3.5 h-3.5" />
                    Before you start · {criticalEntries.length}
                  </span>
                  {criticalEntries.map((entry) => (
                    <JournalEntryCard
                      key={entry.id}
                      entry={entry}
                      machines={machines}
                      dense
                    />
                  ))}
                </div>
              )}

              <div className="br__inset">
                <span className="br__label">
                  <Lightbulb className="w-3.5 h-3.5" />
                  Global goal
                </span>
                <p className="br__quote">
                  {client.globalNotes || "No specific global goal set."}
                </p>
              </div>

              {/* Active coaching focuses, whichever collection they came from -
                  new clientFocuses, legacy focusRecords, or the old
                  one-per-trainer trainerFocuses docs. */}
              {activeJournalFocuses.map((f) => {
                const visual =
                  FOCUS_VISUALS[f.category] || FOCUS_VISUALS.Posture;
                return (
                  <article key={f.id} className="br__focus">
                    <span
                      aria-hidden
                      className={cn("br__focus-edge", visual.edge)}
                    />
                    <span className="br__label">
                      <Target className="w-3.5 h-3.5" />
                      {f.category} · {f.trainerInitials}
                      <span className="br__focus-when">
                        {relativeDay(toDate(f.startedAt))}
                      </span>
                    </span>
                    <p className="br__quote">{f.intent}</p>
                    {f.targetMachineId && (
                      <span className="br__focus-target">
                        Target:{" "}
                        {machines.find((m) => m.id === f.targetMachineId)
                          ?.name || "Unknown machine"}
                      </span>
                    )}
                  </article>
                );
              })}
            </section>

            {/* 2. Routine. The alternation logic proposes one; the trainer
                can override it before starting. */}
            <section className="br-section">
              <header className="br-section__head">
                <h2 className="br-section__title">Today&rsquo;s routine</h2>
                <span className="br-section__hint">
                  {routinePickedByTrainer
                    ? "Manually selected"
                    : `Suggested: Routine ${suggestedType}`}
                </span>
              </header>
              <div
                role="group"
                aria-label="Select today&rsquo;s routine"
                className="br__routines"
              >
                {(["A", "B"] as const).map((type) => {
                  const routine = type === "A" ? routineA : routineB;
                  const active =
                    type === "A"
                      ? ["A", "Create_A"].includes(selectedRoutineType)
                      : ["B", "Create_B"].includes(selectedRoutineType);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handlePickRoutine(type)}
                      aria-pressed={active}
                      className="br__routine"
                    >
                      <span className="br__routine-name">Routine {type}</span>
                      <span className="br__routine-sub">
                        {routine
                          ? `${routine.machineIds?.length || 0} machines`
                          : "Not set up - tap to build"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 3. What is planned, against what actually happened last time. */}
            <div className="br__compare">
              <RoutineCompareCard
                variant="scheduled"
                label="SCHEDULED TODAY"
                title={scheduledRoutineName}
                meta={`${selectedRoutineIds.length} machines`}
              />
              <RoutineCompareCard
                variant="previous"
                label="LAST PERFORMED"
                title={lastRoutineName}
                meta={lastSessionDate.toUpperCase()}
              />
            </div>

            {/* 4. Execution sequence */}
            <section className="br-section br__seq">
              <header className="br-section__head">
                <h2 className="br-section__title">
                  <Activity className="w-4 h-4" />
                  Execution sequence
                </h2>
                <button
                  type="button"
                  className="br__link-btn"
                  aria-pressed={showAddMachine}
                  onClick={() => setShowAddMachine(!showAddMachine)}
                >
                  {showAddMachine ? (
                    <>
                      <Check className="w-3.5 h-3.5" aria-hidden /> Done editing
                    </>
                  ) : (
                    <>
                      <ArrowUpDown className="w-3.5 h-3.5" aria-hidden /> Edit
                      routine
                    </>
                  )}
                </button>
              </header>

              {selectedRoutineIds.length === 0 ? (
                <div className="br__empty">
                  <p className="br__empty-text">
                    Nothing in this routine yet. Add the machines you plan to
                    work through - they are logged in the order you set here.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAddMachine(true)}
                    className="br__link-btn"
                  >
                    <Plus className="w-4 h-4" aria-hidden /> Add first machine
                  </button>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={selectedRoutineIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {selectedRoutineIds.map((machineId, idx) => {
                      const machine = machines.find((m) => m.id === machineId);
                      if (!machine) return null;

                      const getMillis = (ts: any) => {
                        if (!ts) return 0;
                        if (typeof ts.toMillis === "function")
                          return ts.toMillis();
                        if (typeof ts.toDate === "function")
                          return ts.toDate().getTime();
                        if (ts.seconds !== undefined) return ts.seconds * 1000;
                        const d = new Date(ts);
                        return isNaN(d.getTime()) ? 0 : d.getTime();
                      };

                      const mLogs = logs
                        .filter((l) => l.machineId === machineId)
                        .sort(
                          (a, b) =>
                            getMillis(b.createdAt) - getMillis(a.createdAt),
                        );
                      const lastLog = mLogs[0];
                      const clientMetric = client?.currentMachineMetrics?.[machineId];

                      const isTSC =
                        machine.targetRepRange?.toLowerCase().includes("tsc") ||
                        machine.targetRepRange
                          ?.toLowerCase()
                          .includes("static") ||
                        machine.targetRepRange?.toLowerCase().includes("time") ||
                        Boolean(lastLog?.isTSC) ||
                        Boolean(clientMetric?.isTSC);

                      const rawWeight =
                        lastLog?.weight !== undefined && lastLog?.weight !== ""
                          ? lastLog.weight
                          : lastLog?.loadLb !== undefined && lastLog?.loadLb !== ""
                            ? lastLog.loadLb
                            : clientMetric?.weight !== undefined && clientMetric?.weight !== ""
                              ? clientMetric.weight
                              : null;

                      const rawReps = isTSC
                        ? lastLog?.seconds !== undefined && lastLog?.seconds !== ""
                          ? lastLog.seconds
                          : lastLog?.outcomeTut !== undefined && lastLog?.outcomeTut !== ""
                            ? lastLog.outcomeTut
                            : lastLog?.timeSpent !== undefined && lastLog?.timeSpent !== ""
                              ? lastLog.timeSpent
                              : clientMetric?.seconds !== undefined && clientMetric?.seconds !== ""
                                ? clientMetric.seconds
                                : lastLog?.reps !== undefined && lastLog?.reps !== ""
                                  ? lastLog.reps
                                  : clientMetric?.reps !== undefined && clientMetric?.reps !== ""
                                    ? clientMetric.reps
                                    : null
                        : lastLog?.reps !== undefined && lastLog?.reps !== ""
                          ? lastLog.reps
                          : lastLog?.outcomeReps !== undefined && lastLog?.outcomeReps !== ""
                            ? lastLog.outcomeReps
                            : clientMetric?.reps !== undefined && clientMetric?.reps !== ""
                              ? clientMetric.reps
                              : null;

                      const displayMachine = {
                        idx: idx + 1,
                        name: machine.name,
                        lastLb: rawWeight,
                        lastReps: rawReps,
                        lastUnit: isTSC ? "sec" : "reps",
                        isTSC: isTSC,
                      };

                      return (
                        <SortableSequenceItem
                          key={machineId}
                          id={machineId}
                          showAddMachine={showAddMachine}
                          onRemove={() => removeMachine(idx)}
                        >
                          <SequenceRow machine={displayMachine as any} />
                        </SortableSequenceItem>
                      );
                    })}
                  </SortableContext>
                </DndContext>
              )}

              {showAddMachine && (
                <div className="br__add">
                  <span className="br__label">
                    <Plus className="w-3.5 h-3.5" />
                    Add machine
                  </span>
                  <div className="br__add-list">
                    {machines
                      .filter((m) => !selectedRoutineIds.includes(m.id))
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => addMachine(m.id)}
                          className="br__add-item"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden /> {m.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </section>

            {/* 5. How they turned up today. Optional, and the last stop
                before START. */}
            <section className="br-card br__checkin">
              <div className="br__checkin-head">
                <h2 className="br-section__title">
                  <Activity className="w-4 h-4" />
                  Daily recovery check-in
                  <span className="br__optional">Optional</span>
                </h2>
                {/* The 90-day one - sleep, energy, pain, habits, food - saved
                    to the journal as a check-in; the full report can be built
                    from it later. */}
                <button
                  type="button"
                  onClick={() => setShowCheckIn(true)}
                  className="br__link-btn"
                >
                  <HeartPulse className="w-3.5 h-3.5" aria-hidden /> 90-day
                  check-in
                </button>
              </div>

              <PillGroup<SleepQuality>
                label="Sleep"
                value={sleepQuality}
                onChange={(v) => setSleepQuality(v)}
                options={[
                  { value: "poor", label: "Poor" },
                  { value: "average", label: "Average" },
                  { value: "optimal", label: "Optimal" },
                ]}
              />

              <PillGroup<1 | 2 | 3 | 4 | 5>
                label="Stress level (1-5)"
                value={stressLevel}
                onChange={(v) => setStressLevel(v)}
                options={([1, 2, 3, 4, 5] as const).map((n) => ({
                  value: n,
                  label: String(n),
                }))}
              />

              <div className="br__grid2">
                <PillGroup<"low" | "normal" | "high">
                  label="Energy"
                  value={energyLevel}
                  onChange={(v) => setEnergyLevel(v)}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "normal", label: "Normal" },
                    { value: "high", label: "High" },
                  ]}
                />
                <PillGroup<"low" | "neutral" | "good">
                  label="Mood"
                  value={mood}
                  onChange={(v) => setMood(v)}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "neutral", label: "Neutral" },
                    { value: "good", label: "Good" },
                  ]}
                />
              </div>

              {/* Where it hurts, and how. The tracker, the `bodyStates` state
                  and the branch in handleStart that writes it into
                  PreSessionCheckIn all already existed - only this element was
                  missing, so the state could never be anything but empty and
                  the save was dead code. */}
              <fieldset className="br__field">
                <legend className="br__label">Body state</legend>
                <BodyStateTracker
                  value={bodyStates}
                  onChange={setBodyStates}
                />
              </fieldset>

              <fieldset className="br__field">
                <legend className="br__label">Pre-session notes</legend>
                <textarea
                  value={adjustmentNote}
                  onChange={(e) => setAdjustmentNote(e.target.value)}
                  placeholder="How is the client feeling? Any adjustments to the routine?"
                  className="br__textarea"
                />
              </fieldset>
            </section>
            {/* 6. One loud action, sticky to the bottom of the page rather
                than a fixed footer that has to know the nav bar's height. */}
            <div className="br__cta-bar">
              <button type="button" onClick={handleStart} className="br__cta">
                <Play className="w-5 h-5" fill="currentColor" aria-hidden />
                Start session
              </button>
            </div>
        </div>

      <QuickCheckInDialog
        open={showCheckIn}
        onClose={() => setShowCheckIn(false)}
        client={client}
        trainer={authTrainer}
        machines={machines}
        origin="pre_session"
      />
    </div>
  );
}
