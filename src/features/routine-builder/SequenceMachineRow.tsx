/**
 * The one sortable machine row.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Replaces three near-identical implementations: SortableRoutineMachineRow
 * (written to be shared, ever only used by EditRoutineDrawer), and a private
 * SortableSequenceItem in each of SessionRoutineManagerModal and
 * BriefingScreen. They differed in drag library, in what they showed, and in
 * how tall they were — so the same machine looked like three different things
 * depending on which screen a trainer reached it from.
 *
 * Everything optional is driven by props rather than by mode, so a caller
 * asks for what it needs instead of the row guessing.
 */

import { GripVertical, Replace, StickyNote, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../lib/utils";
import { MACHINE_ABBR } from "./academy";
import type { MachineHistoryEntry } from "./types";

export interface SequenceMachineRowProps {
  id: string;
  position: number;
  name: string;
  /** Highest severity this machine participates in, if any. */
  severity?: "avoid" | "caution" | null;
  history?: MachineHistoryEntry | null;
  showHistory?: boolean;
  note?: string;
  showNoteButton?: boolean;
  noteOpen?: boolean;
  onToggleNote?: () => void;
  onRemove?: () => void;
  /** Swap this machine out for today — busy station, or a joint that will
   *  not tolerate it. Absent on the surfaces that persist a routine. */
  onSwap?: () => void;
  /** Not at this studio — reorderable, but flagged. */
  missing?: boolean;
  dense?: boolean;
  disabled?: boolean;
}

function HistoryCell({ value, label }: { value: string | number | null | undefined; label: string }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={cn("rb-row__hist", empty && "rb-row__hist--empty")}>
      <b>{empty ? "—" : value}</b>
      <span>{label}</span>
    </div>
  );
}

export function SequenceMachineRow({
  id,
  position,
  name,
  severity = null,
  history,
  showHistory = false,
  note,
  showNoteButton = false,
  noteOpen = false,
  onToggleNote,
  onRemove,
  onSwap,
  missing = false,
  dense = false,
  disabled = false,
}: SequenceMachineRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const abbr = MACHINE_ABBR[id];

  return (
    <>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          "rb-row",
          isDragging && "rb-row--dragging",
          severity === "avoid" && "rb-row--avoid",
          severity === "caution" && "rb-row--caution",
        )}
      >
        <div
          className="rb-row__handle"
          data-disabled={disabled}
          aria-label={`Reorder ${name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden />
        </div>

        <div className="rb-row__pos" aria-hidden>
          {position}
        </div>

        <div className="rb-row__body">
          <div className="rb-row__name" title={name}>
            {name}
          </div>
          {!dense && (
            <div className="rb-row__meta">
              {abbr && <span className="rb-row__abbr">{abbr}</span>}
              {missing && <span style={{ color: "var(--rb-caution)" }}>not at this studio</span>}
              {history?.lastDate && !missing && <span>{history.lastDate}</span>}
            </div>
          )}
        </div>

        {showHistory && !dense && (
          <>
            <HistoryCell value={history?.lastWeight} label="lb" />
            <HistoryCell
              value={history?.lastReps}
              label={history?.lastUnit === "sec" ? "sec" : "reps"}
            />
          </>
        )}

        {showNoteButton && (
          <button
            type="button"
            className={cn("rb-row__btn", (noteOpen || !!note) && "rb-row__btn--on")}
            onClick={onToggleNote}
            aria-label={note ? `Edit note on ${name}` : `Add a note to ${name}`}
            aria-pressed={noteOpen}
          >
            <StickyNote size={15} aria-hidden />
          </button>
        )}

        {onSwap && !disabled && (
          <button
            type="button"
            className="rb-row__btn"
            onClick={onSwap}
            aria-label={`Swap ${name} out for today`}
          >
            <Replace size={15} aria-hidden />
          </button>
        )}

        {onRemove && !disabled && (
          <button
            type="button"
            className="rb-row__btn"
            onClick={onRemove}
            aria-label={`Remove ${name} from the routine`}
          >
            <Trash2 size={15} aria-hidden />
          </button>
        )}
      </div>

      {note && !noteOpen && <div className="rb-row__note">{note}</div>}
    </>
  );
}
