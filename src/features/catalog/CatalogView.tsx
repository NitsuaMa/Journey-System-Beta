import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Machine, Trainer } from "../../types";
import { useActiveStudio } from "../../ActiveStudioContext";
import { AnatomyStage } from "./AnatomyStage";
import { MachinePickerBar } from "./MachinePickerBar";
import { MachineDetail } from "./MachineDetail";
import { StudioSetupCard } from "./StudioSetupCard";
import { MachinePicker } from "./MachinePicker";
import { X } from "lucide-react";
import { machinesForBodySlug } from "./anatomy";
import {
  MachineUpkeepCard,
  TaskNoteDialog,
  setTaskStatus,
  studioLocation,
  notifyTaskCompletion,
  useMachineUpkeep,
  useStudioTasks,
  type TaskRow,
} from "../studio-tasks";
import { useToast } from "../../contexts/ToastContext";
import { useCatalogMachines } from "./useCatalogMachines";
import { useStudioMachineSettings } from "../../hooks/useStudioMachineSettings";
import { isStudioLeader } from "../../lib/permissions";
import { useLayoutMode } from "./useLayoutMode";
import type { GroupingMode } from "./types";

/**
 * THE CATALOG.
 *
 * Round: Catalog Redesign, Sep 2026. Replaces
 * components/MachineAnatomyCatalogView.tsx (956 lines).
 *
 * This file owns four pieces of state — which machine, which side, which
 * figure, how the list is grouped — and nothing else. Everything below it is
 * derived, so selecting a machine costs no fetch.
 *
 * The old file was long for a structural reason, not a content one: portrait
 * and landscape were written as two independent render trees over the same
 * data, and they drifted. Same markup, different colours (#F06C22 inline in one
 * tree, bg-cta in the other), a line-clamp on one clinical note and not the
 * other, and a max-h-[50dvh] scroll box on the portrait copy alone — which is
 * what buried Clinical Warnings inside a half-screen box on a screen that
 * already scrolled. One <MachineDetail>, two hosts, no drift.
 *
 * Layout, in full:
 *
 *   split  grid of three columns. The rail and the detail pane are the only
 *          scrollers, so the figure column simply never moves. No sticky
 *          positioning and no scroll listener are involved in keeping the
 *          model on screen.
 *
 *   stack  the root scrolls; nothing inside it does.
 */
export interface CatalogViewProps {
  /** The global list. Used only until this studio's roster is populated. */
  machines: Machine[];
  authTrainer?: Trainer | null;
}

export function CatalogView({ machines, authTrainer }: CatalogViewProps) {
  const { activeStudioId, activeStudio } = useActiveStudio();
  const layout = useLayoutMode();

  const { machines: catalogMachines, source } = useCatalogMachines(
    activeStudioId,
    machines,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"front" | "back">("front");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [grouping, setGrouping] = useState<GroupingMode>("movement");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Upkeep is read ONCE here and passed down. Mounting these inside the detail
  // pane would re-subscribe on every machine tap — twenty-two listeners torn
  // down and rebuilt while a trainer scrolls the rail.
  const { success: toastSuccess, error: toastError } = useToast();
  const { byMachineId: upkeepById } = useMachineUpkeep(activeStudioId);

  // Read once here for the same reason upkeep is: mounting this inside the
  // detail pane would tear down and rebuild the listener on every tap in the
  // rail. Studio settings moved into the Catalog this round - see
  // StudioSetupCard for why they are not a Trainer Settings shortcut.
  const { settingsByMachineId } = useStudioMachineSettings(activeStudioId);
  const canEditStudioSetup = isStudioLeader(authTrainer ?? null);

  const studioSetupFor = (machineId: string, machineName: string) => (
    <StudioSetupCard
      machineId={machineId}
      machineName={machineName}
      studioId={activeStudioId}
      setting={settingsByMachineId[machineId]}
      canEdit={canEditStudioSetup}
      authorId={authTrainer?.id ?? null}
    />
  );
  const { rows: todayTaskRows } = useStudioTasks(activeStudioId);
  const [noteRow, setNoteRow] = useState<TaskRow | null>(null);
  const [upkeepBusy, setUpkeepBusy] = useState(false);

  const selected = useMemo(
    () => catalogMachines.find((m) => m.id === selectedId) ?? null,
    [catalogMachines, selectedId],
  );

  // Land on a machine rather than an "Awaiting Selection" placeholder that
  // occupies the widest pane on the screen and says nothing.
  useEffect(() => {
    if (catalogMachines.length === 0) return;
    if (selectedId && catalogMachines.some((m) => m.id === selectedId)) return;
    setSelectedId(catalogMachines[0].id);
  }, [catalogMachines, selectedId]);

  // Turn the figure to the side that actually shows the activation, on EVERY
  // path that can change the selection. Doing this inside the click handler is
  // what let swiping the old carousel leave Hip Abduction rendered on the
  // anterior view, where none of its target muscles are visible.
  const preferredView = selected?.anatomy.preferredView;
  useEffect(() => {
    if (preferredView) setView(preferredView);
  }, [selectedId, preferredView]);

  const handleRegionClick = (slug: string) => {
    const owned = new Set(catalogMachines.map((m) => m.id));
    const target = machinesForBodySlug(slug).find((id) => owned.has(id));
    if (target) setSelectedId(target);
  };

  const machineTaskRows = useMemo(() => {
    const map: Record<string, TaskRow[]> = {};
    for (const r of todayTaskRows) {
      if (!r.machineId) continue;
      (map[r.machineId] ??= []).push(r);
    }
    return map;
  }, [todayTaskRows]);

  const author = authTrainer?.id
    ? { id: authTrainer.id, name: authTrainer.fullName ?? "" }
    : null;

  const runUpkeep = async (
    row: TaskRow,
    status: "done" | "open",
    note?: string,
    flagged?: boolean,
  ) => {
    if (!activeStudioId) return;
    setUpkeepBusy(true);
    try {
      await setTaskStatus({
        // Machine upkeep is always the studio's shared checklist, never a
        // trainer's private list: the machine belongs to the location.
        location: studioLocation(activeStudioId),
        planned: row,
        status,
        author,
        note,
        flagged,
      });
      // The Catalog is where a broken pad actually gets noticed, so this
      // path matters more than the board's: a trainer standing at the machine
      // flags it here, and the studio leader hears about it without anyone
      // walking to the To-Do screen.
      if (status === "done") {
        await notifyTaskCompletion({
          row,
          author,
          studioId: activeStudioId,
          flagged,
          note,
        });
      }
      toastSuccess(status === "done" ? "Marked done." : "Re-opened.");
    } catch (err) {
      console.error("Failed to update machine upkeep:", err);
      toastError("Could not save. Check your connection.");
    } finally {
      setUpkeepBusy(false);
    }
  };

  const upkeepFor = (machineId: string) => (
    <MachineUpkeepCard
      machineId={machineId}
      rows={machineTaskRows[machineId] ?? []}
      upkeep={upkeepById[machineId]}
      busy={upkeepBusy}
      onComplete={(row) => {
        if (row.status !== "done" && row.template?.requiresNote) {
          setNoteRow(row);
          return;
        }
        runUpkeep(row, row.status === "done" ? "open" : "done");
      }}
      onAddNote={setNoteRow}
    />
  );

  const stage = selected ? (
    <AnatomyStage
      anatomy={selected.anatomy}
      view={view}
      gender={gender}
      onViewChange={setView}
      onGenderChange={setGender}
      onRegionClick={handleRegionClick}
    />
  ) : null;

  const flaggedIds = useMemo(
    () =>
      new Set(
        Object.keys(upkeepById).filter((id) => upkeepById[id]?.flagged),
      ),
    [upkeepById],
  );

  const picker = (
    <MachinePicker
      machines={catalogMachines}
      selectedId={selectedId}
      onSelect={setSelectedId}
      grouping={grouping}
      onGroupingChange={setGrouping}
      flaggedIds={flaggedIds}
    />
  );

  if (catalogMachines.length === 0) {
    return (
      <div className={`cat cat--${layout}`}>
        <div className="cat__placeholder">
          <p className="cat__placeholder-title">No machines yet</p>
          <p className="cat__placeholder-body">
            {activeStudioId
              ? `${activeStudio?.name ?? "This studio"} has no machines on its roster. Add equipment from Hub → Machine Settings.`
              : "Select a studio to see its equipment."}
          </p>
        </div>
      </div>
    );
  }

  if (layout === "split") {
    return (
      <div className="cat cat--split" data-source={source}>
        <aside className="cat__pane" aria-label="Machines">
          {picker}
        </aside>

        <div className="cat__stage-col">{stage}</div>

        <aside className="cat__pane" aria-label="Machine detail">
          <div className="cat__scroller">
            {selected && (
              <MachineDetail
                machine={selected}
                studioId={activeStudioId}
                studioName={activeStudio?.name}
                author={author}
                upkeep={upkeepFor(selected.id)}
                studioSetup={studioSetupFor(selected.id, selected.name)}
                isFlagged={Boolean(upkeepById[selected.id]?.flagged)}
              />
            )}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="cat cat--stack" data-source={source}>
      {stage}

      {/* Sticky, and deliberately placed AFTER the figure: at rest the model is
          full size above it, and the moment the model scrolls away this pins to
          the top still carrying it. */}
      <MachinePickerBar
        machine={selected}
        count={catalogMachines.length}
        view={view}
        gender={gender}
        onOpen={() => setSheetOpen(true)}
      />

      {selected && (
        <MachineDetail
          machine={selected}
          studioId={activeStudioId}
          studioName={activeStudio?.name}
          author={author}
          upkeep={upkeepFor(selected.id)}
          studioSetup={studioSetupFor(selected.id, selected.name)}
          isFlagged={Boolean(upkeepById[selected.id]?.flagged)}
        />
      )}

      {/* The app's own Sheet (Base UI dialog): focus trap, Escape, scroll lock
          and the enter/exit transitions all come with it. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="cat__sheet"
        >
          <div className="cat__sheet-head">
            <SheetTitle className="cat__sheet-title">
              Select machine
            </SheetTitle>
            <button
              type="button"
              className="cat__sheet-close"
              onClick={() => setSheetOpen(false)}
              aria-label="Close"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <MachinePicker
            flaggedIds={flaggedIds}
            machines={catalogMachines}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setSheetOpen(false);
            }}
            grouping={grouping}
            onGroupingChange={setGrouping}
            variant="sheet"
            autoFocusSearch
          />
        </SheetContent>
      </Sheet>

      <TaskNoteDialog
        row={noteRow}
        open={Boolean(noteRow)}
        onOpenChange={(o) => !o && setNoteRow(null)}
        onSubmit={(note, flagged) =>
          noteRow ? runUpkeep(noteRow, "done", note, flagged) : undefined
        }
      />
    </div>
  );
}
