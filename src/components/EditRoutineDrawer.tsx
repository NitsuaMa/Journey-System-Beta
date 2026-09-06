import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  X,
  Sparkles,
  Building2,
  Save,
  AlertTriangle,
  ClipboardCheck,
  Lock,
} from "lucide-react";
import { db } from "../firebase";
import { cn, safeToDate } from "../lib/utils";
import { GLOBAL_ROUTINE_PRESETS } from "../data/routine-presets";
import {
  describeDeviation,
  deviationSummary,
  normalizeRoutinePreset,
  templateProvenance,
} from "../lib/routine-templates";
import { useToast } from "../contexts/ToastContext";
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
import {
  RoutineBuilder,
  type MachineHistoryEntry,
} from "../features/routine-builder";
import type {
  Client,
  Machine,
  Routine,
  RoutinePreset,
  Trainer,
  WorkoutSession,
  ExerciseLog,
} from "../types";

type RoutineSlot = "Routine A" | "Routine B";

interface EditRoutineDrawerProps {
  client: Client | null;
  clientId: string | null;
  routines: Routine[];
  machines: Machine[];
  activeStudioId: string | null;
  studioName?: string;
  authTrainer?: Trainer | null;
  /** Client's full session history, used to look up each machine's
   * last-performed weight/date for the sequence list (round 4). */
  sessions: WorkoutSession[];
  allLogs: ExerciseLog[];
  /** Which routine to open on ("Routine A" / "Routine B"), or null when closed. */
  target: RoutineSlot | null;
  onClose: () => void;
  /** Called with the freshly-refetched routines for this client after a save. */
  onSaved: (routines: Routine[]) => void;
  /** Opens the existing reason-gated "enable Protocol B" flow (defined in
   * ClientProfileView.tsx) when the trainer taps the inactive B tab. */
  onRequestActivateRoutineB?: () => void;
}

/**
 * The client-profile "Edit Routine" modal — widened for iPad, with an
 * in-drawer A/B toggle (switch which routine you're editing, or activate
 * Routine B on the spot, without closing), a static full-catalog machine
 * list (no search/filters — 20 machines doesn't need them), and a two-tier
 * Preset Routines section (built-in + this studio's own).
 *
 * Saving still writes to `routines` + `routineAdjustments` exactly as
 * before, so the Routines tab cards (which read the same `routines` state
 * in ClientProfileView) stay in sync the moment a save completes.
 */
export function EditRoutineDrawer({
  client,
  clientId,
  routines,
  machines,
  activeStudioId,
  studioName,
  authTrainer,
  sessions,
  allLogs,
  target,
  onClose,
  onSaved,
  onRequestActivateRoutineB,
}: EditRoutineDrawerProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const isOpen = target !== null;

  const [activeSlot, setActiveSlot] = useState<RoutineSlot>("Routine A");
  const [machineIds, setMachineIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSlotSwitch, setPendingSlotSwitch] = useState<RoutineSlot | null>(null);
  // Every preset, split by tier below. One listener rather than three
  // queries: the collection is small, and separate queries would let the
  // tiers arrive at different times and reorder under the trainer's thumb.
  const [allPresets, setAllPresets] = useState<RoutinePreset[]>([]);
  /**
   * The template applied in THIS editing session, if any. Drives the
   * deviation banner and the provenance written on save.
   */
  const [appliedTemplate, setAppliedTemplate] = useState<RoutinePreset | null>(null);
  const [pendingPreset, setPendingPreset] = useState<RoutinePreset | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [showSavePresetInput, setShowSavePresetInput] = useState(false);
  const [savedFlash, setSavedFlash] = useState<RoutineSlot | null>(null);
  // Keyboard-avoidance for the Notes field (round 4): tracked via the
  // VisualViewport API so an on-screen tablet keyboard never covers the
  // Notes textarea, which now lives in the footer next to Close/Apply.
  const [notesFocused, setNotesFocused] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState<{
    top: number;
    maxHeight: number;
  } | null>(null);

  // Both routine slots, falling back to an unsaved placeholder — mirrors the
  // temp-a/temp-b pattern the Routines tab cards already use.
  const routineFor = useCallback(
    (name: RoutineSlot): Routine => {
      const found = routines.find((r) => r.name === name);
      return (
        found || {
          id: name === "Routine A" ? "temp-a" : "temp-b",
          name,
          clientId: clientId || "",
          machineIds: [],
          studioId: client?.homeStudioId || "",
        }
      );
    },
    [routines, clientId, client?.homeStudioId],
  );

  const loadSlot = useCallback(
    (name: RoutineSlot) => {
      const r = routineFor(name);
      setActiveSlot(name);
      setMachineIds([...r.machineIds]);
      setSnapshot([...r.machineIds]);
      setReason("");
      setPendingSlotSwitch(null);
    },
    [routineFor],
  );

  // Reset to the routine that was clicked whenever the drawer (re)opens.
  useEffect(() => {
    if (target) loadSlot(target);
    setNotesFocused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Track the on-screen keyboard via VisualViewport so the Notes field
  // (now in the footer) can be pushed above it while a trainer is typing.
  // Degrades gracefully to the existing static layout on browsers without
  // VisualViewport support.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv || !isOpen) {
      setKeyboardOffset(null);
      return;
    }
    const handleViewportChange = () => {
      // A visual viewport noticeably shorter than the layout viewport
      // means an on-screen keyboard is covering the bottom of the screen.
      const keyboardLikelyOpen = vv.height < window.innerHeight * 0.85;
      if (keyboardLikelyOpen) {
        setKeyboardOffset({ top: vv.offsetTop, maxHeight: vv.height - 24 });
      } else {
        setKeyboardOffset(null);
      }
    };
    handleViewportChange();
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, [isOpen]);

  // Only reposition the dialog while the Notes field is actually focused —
  // otherwise leave the normal centered layout alone.
  const dialogPositionStyle: CSSProperties =
    notesFocused && keyboardOffset
      ? {
          top: keyboardOffset.top + 12,
          left: "50%",
          transform: "translateX(-50%)",
          maxHeight: keyboardOffset.maxHeight,
        }
      : {};

  const isDirty = useMemo(
    () => machineIds.join(",") !== snapshot.join(","),
    [machineIds, snapshot],
  );

  const handleRequestSlot = (name: RoutineSlot) => {
    if (name === activeSlot) return;
    if (name === "Routine B" && !client?.isRoutineBActive) return;
    if (isDirty) {
      setPendingSlotSwitch(name);
      return;
    }
    loadSlot(name);
  };

  // Live templates and presets, all tiers (round: Routine Template Builder,
  // Sep 2026). Previously this queried only studioId == activeStudioId,
  // because company templates lived in code rather than Firestore.
  useEffect(() => {
    if (!isOpen) {
      setAllPresets([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "routinePresets"),
      (snap) =>
        setAllPresets(
          snap.docs.map((d) => normalizeRoutinePreset({ id: d.id, ...d.data() })),
        ),
    );
    return () => unsub();
  }, [isOpen]);

  /**
   * Company standards. Falls back to the hardcoded set while the collection
   * has none, so an empty database degrades to the previous behavior rather
   * than to an empty menu.
   */
  const companyTemplates = useMemo(() => {
    const fromDb = allPresets
      .filter((p) => p.tier === "company")
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return fromDb.length > 0 ? fromDb : GLOBAL_ROUTINE_PRESETS;
  }, [allPresets]);

  /** This studio's own templates first, then trainer-saved presets. */
  const studioPresets = useMemo(() => {
    if (!activeStudioId) return [];
    return allPresets
      .filter((p) => p.studioId === activeStudioId)
      .sort(
        (a, b) =>
          (a.tier === "studio" ? 0 : 1) - (b.tier === "studio" ? 0 : 1) ||
          (a.name || "").localeCompare(b.name || ""),
      );
  }, [allPresets, activeStudioId]);

  // Last-performed weight + date per machine, sourced from this client's
  // own session logs (round 4). Sorted by sessionNumber first (an
  // incrementing per-client counter, the most reliable recency signal) and
  // falls back to the session's date only to break ties, rather than
  // mixing the two the way the Routines-tab cards do elsewhere. Machines
  // the client has never performed are simply absent from the map, and the
  // row below falls back to "N/A" for both fields.
  const lastPerformedByMachine = useMemo(() => {
    const map: Record<string, MachineHistoryEntry> = {};
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const relevantLogs = allLogs
      .filter((l) => !!l.machineId && sessionById.has(l.sessionId))
      .sort((a, b) => {
        const sessA = sessionById.get(a.sessionId);
        const sessB = sessionById.get(b.sessionId);
        const numA = sessA?.sessionNumber ?? 0;
        const numB = sessB?.sessionNumber ?? 0;
        if (numB !== numA) return numB - numA;
        const dateA = safeToDate(sessA?.date)?.getTime() ?? 0;
        const dateB = safeToDate(sessB?.date)?.getTime() ?? 0;
        return dateB - dateA;
      });
    for (const log of relevantLogs) {
      const machineId = log.machineId;
      if (!machineId || map[machineId]) continue;
      const session = sessionById.get(log.sessionId);
      const weight = log.weight || log.loadLb || "";
      const sessionDate = safeToDate(session?.date);
      map[machineId] = {
        lastWeight: weight ? String(weight) : null,
        lastReps: log.reps ?? null,
        lastUnit: "reps",
        lastDate: sessionDate
          ? sessionDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : null,
      };
    }
    return map;
  }, [sessions, allLogs]);

  /**
   * The other half of the rotation, for the twice-weekly analysis.
   *
   * Read from the saved routine rather than from local state: the trainer is
   * editing one slot, and the question the panel answers is whether this slot
   * covers what the OTHER one already trains. An unsaved edit to the slot on
   * screen must not move that target.
   */
  const counterpartMachineIds = useMemo(() => {
    const other: RoutineSlot = activeSlot === "Routine A" ? "Routine B" : "Routine A";
    if (other === "Routine B" && !client?.isRoutineBActive) return null;
    return routineFor(other).machineIds ?? null;
  }, [activeSlot, client?.isRoutineBActive, routineFor]);

  /**
   * What this client actually reported, matched against the Academy's
   * exercise selection templates so suggestions lean toward their conditions
   * and goals rather than toward a generic routine.
   */
  const purposeText = useMemo(
    () =>
      [client?.medicalHistory, client?.goals, (client?.clinicalProfile ?? []).join(" ")]
        .filter(Boolean)
        .join(" · ") || null,
    [client?.medicalHistory, client?.goals, client?.clinicalProfile],
  );

  /**
   * How far the trainer has moved from the template they applied.
   * Advisory only -- nothing here blocks a save. The point is that a
   * departure from the house standard is visible rather than silent.
   */
  const deviation = useMemo(
    () => describeDeviation(machineIds, appliedTemplate?.machineIds),
    [machineIds, appliedTemplate],
  );
  const deviationText = useMemo(
    () =>
      deviationSummary(
        deviation,
        (id) => machines.find((m) => m.id === id)?.name ?? id,
      ),
    [deviation, machines],
  );

  const applyPreset = (preset: RoutinePreset) => {
    // A template may name equipment this location does not have; the studio
    // roster, not the template, decides what is actually available.
    const validIds = preset.machineIds.filter((id) =>
      machines.some((m) => m.id === id),
    );
    setMachineIds(validIds);
    setReason((prev) => (prev.trim() ? prev : `Applied "${preset.name}" preset.`));
    setPendingPreset(null);
    // Provenance is recorded against what the template ASKED FOR, not the
    // filtered list: a machine dropped because the studio lacks it is a real
    // deviation from the standard and should show as one.
    setAppliedTemplate(preset);
  };

  const handleUsePreset = (preset: RoutinePreset) => {
    if (machineIds.length > 0) {
      setPendingPreset(preset);
      return;
    }
    applyPreset(preset);
  };

  const handleSaveStudioPreset = async () => {
    const name = presetNameDraft.trim();
    if (!name || !activeStudioId || machineIds.length === 0) return;
    setIsSavingPreset(true);
    try {
      await addDoc(collection(db, "routinePresets"), {
        name,
        machineIds,
        // Explicit, so the admin hub can tell an ad-hoc preset from an
        // official template without inferring it from scope.
        tier: "trainer",
        scope: activeStudioId,
        studioId: activeStudioId,
        createdBy: authTrainer?.id || null,
        createdByName: authTrainer?.fullName || "Trainer",
        createdAt: serverTimestamp(),
      });
      toastSuccess(`Saved "${name}" as a studio preset.`);
      setPresetNameDraft("");
      setShowSavePresetInput(false);
    } catch (err) {
      console.error("Error saving routine preset:", err);
      toastError("Couldn't save that preset. Try again.");
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleDeleteStudioPreset = async (preset: RoutinePreset) => {
    if (!preset.id) return;
    // Studio templates belong to the location's leader and company standards
    // to an admin. The rules would reject the write anyway; refusing here
    // means a clear sentence instead of a permission error.
    if (preset.tier && preset.tier !== "trainer") {
      toastError(
        "That's an official template — a studio leader manages it from the admin hub.",
      );
      return;
    }
    try {
      await deleteDoc(doc(db, "routinePresets", preset.id));
    } catch (err) {
      console.error("Error deleting routine preset:", err);
      toastError("Couldn't delete that preset.");
    }
  };

  const handleSave = async () => {
    if (!clientId || reason.trim().length < 3) return;
    const current = routineFor(activeSlot);
    /**
     * Written only when a template was applied in this session. Otherwise
     * absent, so editing an untemplated routine never invents provenance and
     * re-saving a templated one does not wipe what it already had.
     */
    const provenance = appliedTemplate
      ? {
          ...templateProvenance(appliedTemplate),
          templateAppliedAt: serverTimestamp(),
          ...(Object.keys(appliedTemplate.machineNotes ?? {}).length
            ? { machineNotes: appliedTemplate.machineNotes }
            : {}),
        }
      : {};
    setIsSaving(true);
    try {
      let finalId = current.id!;
      if (current.id?.startsWith("temp-")) {
        const docRef = await addDoc(collection(db, "routines"), {
          clientId,
          name: activeSlot,
          machineIds,
          ...provenance,
          createdAt: serverTimestamp(),
          studioId: client?.homeStudioId || activeStudioId || "",
        });
        finalId = docRef.id;
        await addDoc(collection(db, "routineAdjustments"), {
          clientId,
          routineId: finalId,
          previousMachineIds: [],
          newMachineIds: machineIds,
          trainerId: authTrainer?.id || "unknown",
          notes: reason,
          studioId: client?.homeStudioId || activeStudioId || "",
          changeType: "created",
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "routines", finalId), {
          machineIds,
          ...provenance,
          updatedAt: serverTimestamp(),
        });
        await addDoc(collection(db, "routineAdjustments"), {
          clientId,
          routineId: finalId,
          previousMachineIds: snapshot,
          newMachineIds: machineIds,
          trainerId: authTrainer?.id || "unknown",
          notes: reason,
          studioId: client?.homeStudioId || activeStudioId || "",
          changeType: "machines",
          createdAt: serverTimestamp(),
        });
      }

      const qRoutines = query(
        collection(db, "routines"),
        where("clientId", "==", clientId),
      );
      const snap = await getDocs(qRoutines);
      const updated = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Routine);
      onSaved(updated);

      setSnapshot([...machineIds]);
      setReason("");
      setSavedFlash(activeSlot);
      window.setTimeout(() => setSavedFlash(null), 2500);
    } catch (err) {
      console.error("Error saving routine edit drawer:", err);
      toastError("Couldn't save the routine. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Deliberately no early-return-null when closed: keeping the Dialog
  // mounted with open={isOpen} lets Radix play its fade/zoom-out closing
  // animation instead of the tree vanishing instantly.
  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        style={dialogPositionStyle}
        className="w-[97vw] sm:max-w-[97vw] xl:max-w-[1360px] max-h-[94vh] overflow-hidden flex flex-col p-0 gap-0 bg-white dark:bg-slate-900 rounded-2xl border border-div-l"
      >
        <DialogHeader className="p-5 sm:p-6 pb-4 border-b border-div-l shrink-0 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-xl font-bold uppercase tracking-tight text-slate-900 dark:text-neutral-100 italic font-display">
                Edit Routine
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-1">
                Adjust the machine order, remove/add machines, and provide a
                mandatory reason explaining this clinical adjustment.
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 shrink-0"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Routine A/B switch (left) and Preset Routines (right) share this
              row now — presets used to live wedged under the machine list,
              stealing the height that list needs to show all 20 machines at
              once. Moving them up here, beside the toggle, was the whole
              point of round 4. */}
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="flex flex-col gap-3 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                {(["Routine A", "Routine B"] as const).map((slot) => {
                  const inactive = slot === "Routine B" && !client?.isRoutineBActive;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() =>
                        inactive
                          ? onRequestActivateRoutineB?.()
                          : handleRequestSlot(slot)
                      }
                      className={cn(
                        "h-11 px-5 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all flex items-center gap-2",
                        activeSlot === slot
                          ? "bg-cyan text-white border-transparent shadow-sm shadow-cyan/20"
                          : inactive
                            ? "bg-slate-50 dark:bg-slate-900/40 border-dashed border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-cyan hover:text-cyan dark:hover:text-cyan cursor-pointer"
                            : "bg-slate-100 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800",
                      )}
                      title={
                        inactive
                          ? "Protocol B isn't active for this client yet — tap to activate"
                          : undefined
                      }
                    >
                      {inactive && <Lock className="w-3 h-3" />}
                      {slot}
                      {inactive && (
                        <span className="text-[9px] font-semibold normal-case tracking-normal opacity-80">
                          Tap to Activate
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {savedFlash && (
                <span className="text-[11px] font-semibold text-emerald-500">
                  &#10003; {savedFlash} saved
                </span>
              )}

              {pendingSlotSwitch && (
                <div className="flex flex-col gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-xs w-72">
                  <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Switching to {pendingSlotSwitch} will discard unsaved
                    changes to {activeSlot}.
                  </span>
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-[11px] font-bold uppercase"
                      onClick={() => setPendingSlotSwitch(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-[11px] font-bold uppercase bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => loadSlot(pendingSlotSwitch)}
                    >
                      Discard &amp; Switch
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 lg:border-l lg:pl-4 border-div-l/40">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">
                  Preset Routines
                </h3>
                {machineIds.length > 0 && !showSavePresetInput && (
                  <button
                    type="button"
                    onClick={() => setShowSavePresetInput(true)}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan hover:text-cyan/80 shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" /> Save Current
                  </button>
                )}
              </div>

              {showSavePresetInput && (
                <div className="flex items-center gap-2 mb-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-div-l/30">
                  <Input
                    autoFocus
                    value={presetNameDraft}
                    onChange={(e) => setPresetNameDraft(e.target.value)}
                    placeholder={`e.g., ${studioName || "Studio"} Beginner Circuit`}
                    className="h-8 rounded-lg text-xs bg-white dark:bg-slate-900"
                  />
                  <Button
                    size="sm"
                    disabled={!presetNameDraft.trim() || isSavingPreset}
                    onClick={handleSaveStudioPreset}
                    className="h-8 rounded-lg text-[11px] font-bold uppercase bg-cta text-white hover:bg-cta-strong shrink-0"
                  >
                    {isSavingPreset ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowSavePresetInput(false);
                      setPresetNameDraft("");
                    }}
                    className="h-8 rounded-lg text-[11px] font-bold uppercase shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
                <PresetPillRow
                  icon={<Sparkles className="w-3 h-3" />}
                  label="Company Standard"
                  presets={companyTemplates}
                  onUse={handleUsePreset}
                />
                <PresetPillRow
                  icon={<Building2 className="w-3 h-3" />}
                  label={studioName || "This Studio"}
                  presets={studioPresets}
                  onUse={handleUsePreset}
                  onDelete={handleDeleteStudioPreset}
                  emptyText="None saved yet — build a routine and save it below."
                />
              </div>

              {appliedTemplate && (
                <div
                  className={`mt-2.5 flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                    deviation.hasDeviation
                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                  }`}
                >
                  <ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="font-semibold">{appliedTemplate.name}</span>
                    {deviation.hasDeviation ? (
                      <> — changed: {deviationText}</>
                    ) : (
                      <> — following the template exactly.</>
                    )}
                  </span>
                </div>
              )}

              {pendingPreset && (
                <div className="mt-2.5 flex items-center justify-between gap-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-xs">
                  <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Replace the current {machineIds.length}-machine sequence
                    with &quot;{pendingPreset.name}&quot;?
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px] font-bold uppercase"
                      onClick={() => setPendingPreset(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-[10px] font-bold uppercase bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => applyPreset(pendingPreset)}
                    >
                      Replace
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* The sequence list, the machine picker, the client model, the
            rule warnings and the suggestions all live in the shared builder
            now. What stays in this file is what is genuinely specific to
            editing a client's BASELINE routine: the A/B slot switch, the
            preset tiers, template provenance, the mandatory reason, and the
            Firestore write. */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <RoutineBuilder
            mode="baseline"
            slot={activeSlot === "Routine A" ? "A" : "B"}
            machineIds={machineIds}
            onChange={setMachineIds}
            machines={machines}
            client={client}
            history={lastPerformedByMachine}
            counterpartMachineIds={counterpartMachineIds}
            counterpartLabel={activeSlot === "Routine A" ? "Routine B" : "Routine A"}
            purposeText={purposeText}
            established={sessions.length >= 6}
          />
        </div>

        {/* Footer — Notes now lives here (round 4), in the same band as
            Close/Apply, instead of its own strip inside the scrollable
            body. Same field/data as before (still what lands in
            routineAdjustments.notes). onFocus/onBlur drive the
            keyboard-avoidance repositioning above: while this field is
            focused and the VisualViewport reports a shrunk (keyboard-
            covered) viewport, the whole dialog shifts up so this stays
            visible above an on-screen tablet keyboard. */}
        <div className="border-t border-div-l shrink-0 bg-white dark:bg-slate-900">
          <div className="px-5 sm:px-6 pt-4 pb-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-neutral-350 mb-2 font-display">
              Notes — Why are you making this change?{" "}
              <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onFocus={() => setNotesFocused(true)}
              onBlur={() => setNotesFocused(false)}
              placeholder="e.g., Decreasing spinal load post L4 herniation flare-up; swapping leg press for leg extension today."
              rows={2}
              className="rounded-xl border-div-l bg-white dark:bg-slate-900 resize-none text-xs text-slate-800 dark:text-neutral-100"
            />
            <div className="flex justify-between items-center mt-2">
              <p className="text-[10px] text-slate-400">
                Provide a brief clinical rationale for{" "}
                {client?.firstName ? `${client.firstName}'s` : "the client's"}{" "}
                profile logs.
              </p>
              <p
                className={cn(
                  "text-[10px] font-semibold tracking-wide",
                  reason.trim().length >= 3
                    ? "text-emerald-500"
                    : "text-amber-500",
                )}
              >
                {reason.trim().length >= 3
                  ? "✓ Reason captured"
                  : "Reason required"}
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-3 border-t border-div-l/40 flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={onClose}
              className="rounded-xl uppercase font-bold text-xs"
            >
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={reason.trim().length < 3 || isSaving || !isDirty}
              className="bg-cta text-white hover:bg-cta-strong rounded-xl uppercase font-bold text-xs shadow-md shadow-cta/15"
            >
              {isSaving ? "Saving Changes..." : `Apply ${activeSlot}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Compact pill list — designed to fit in the header beside the A/B toggle,
// unlike the old card-grid version this replaced (round 4: presets moved up
// out of the machine-list column so that column could show all 20 machines).
function PresetPillRow({
  icon,
  label,
  presets,
  onUse,
  onDelete,
  emptyText,
}: {
  icon: ReactNode;
  label: string;
  presets: RoutinePreset[];
  onUse: (p: RoutinePreset) => void;
  onDelete?: (p: RoutinePreset) => void;
  emptyText?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
        {icon} <span className="truncate">{label}</span>
      </div>
      {presets.length === 0 ? (
        <p className="text-[10px] text-slate-400 italic">
          {emptyText || "None yet."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
          {presets.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-1 pl-2.5 pr-1.5 h-7 rounded-full border border-div-l/50 bg-white dark:bg-slate-900 text-[10px] font-bold uppercase tracking-tight text-slate-700 dark:text-neutral-300"
              title={`${p.machineIds.length} machine${p.machineIds.length === 1 ? "" : "s"}`}
            >
              <button
                type="button"
                onClick={() => onUse(p)}
                className="flex items-center gap-1 hover:text-cyan"
              >
                <span className="truncate max-w-32">{p.name}</span>
                <span className="text-slate-400 font-mono normal-case">
                  ({p.machineIds.length})
                </span>
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(p)}
                  className="text-slate-300 hover:text-red-500 rounded-full p-0.5 shrink-0"
                  title="Delete preset"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
