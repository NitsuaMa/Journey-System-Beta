import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RoutineBuilder, type MachineHistoryEntry } from "../features/routine-builder";
import type { Client, Machine } from "../types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentMachineIds: string[];
  machines: Machine[];
  onSave: (machineIds: string[]) => void;
  /** Optional context. Absent, the builder simply shows less. */
  client?: Client | null;
  history?: Record<string, MachineHistoryEntry>;
}

/**
 * Mid-session routine changes.
 *
 * Trainers change the machine, or the order of machines, on the fly during a
 * live session — it is a normal workflow, not an edge case — so this modal
 * has to be as capable as the client-profile editor without being as slow to
 * read. It runs the shared RoutineBuilder in `in-session` mode: shorter rows,
 * no preset picker, no per-machine notes, but the same rule checking, the same
 * suggestions and the same figure the trainer saw when the routine was built.
 *
 * Round: Unified Routine Builder, Sep 2026. Previously this file carried its
 * own SortableSequenceItem and a flat wall of "add machine" buttons, so a
 * mid-session change was the one place a trainer got no warning that they had
 * just put two pulling movements back to back.
 *
 * Still session-scoped: onSave hands the ids back to WorkoutTrackerView and
 * the persisted routine document is untouched. Nothing here writes to
 * Firestore, which is why the builder is controlled by local state.
 */
export function SessionRoutineManagerModal({
  isOpen,
  onOpenChange,
  currentMachineIds,
  machines,
  onSave,
  client = null,
  history,
}: Props) {
  const [localIds, setLocalIds] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) setLocalIds(currentMachineIds);
  }, [isOpen, currentMachineIds]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-5xl bg-bg-dark border border-div-d text-ink-d1 p-0 overflow-hidden shadow-2xl rounded-3xl flex flex-col h-[86vh] md:h-[80vh]">
        <DialogHeader className="px-4 py-3 md:px-6 md:py-4 bg-bg-dark border-b border-div-d shrink-0">
          <DialogTitle className="text-lg md:text-xl font-display italic font-black uppercase tracking-widest text-ink-d1">
            Edit routine sequence
          </DialogTitle>
          <DialogDescription className="text-ink-d3 font-bold uppercase tracking-widest text-[11px] mt-1">
            This session only — the client's saved routine is not changed
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          <RoutineBuilder
            mode="in-session"
            machineIds={localIds}
            onChange={setLocalIds}
            machines={machines}
            client={client}
            history={history}
            established
          />
        </div>

        <DialogFooter className="p-3 md:p-4 bg-surface-1 border-t border-div-d shrink-0 flex flex-row items-center justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-ink hover:text-ink-d1 uppercase font-bold tracking-widest text-[11px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(localIds);
              onOpenChange(false);
            }}
            className="bg-cta hover:bg-cta-strong text-ink-d1 font-system font-bold uppercase tracking-widest shadow-md text-[11px]"
          >
            Confirm sequence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
