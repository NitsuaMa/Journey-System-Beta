import { useEffect, useState } from "react";
import { Loader2, Trash2, Wrench } from "lucide-react";
import { addMachineNote, deleteMachineNote, type JournalContext, type MutationAuthor } from "./mutations";
import type { EquipmentMachine } from "./types";

/**
 * Machine-specific notes (box 11) — the things that are not settings.
 * "Needs extra chest padding on the compound row" is not a dial value, but it
 * is exactly what the next trainer needs to know.
 *
 * Every note filed here also lands in the client's Journal as an `equipment`
 * entry. A note flagged for maintenance files as CRITICAL, which is what puts
 * it in the pre-session briefing — so the next trainer learns the seat sticks
 * before they walk the client up to it, not after.
 */

function formatWhen(ts: unknown): string {
  const d = ts instanceof Date ? ts : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export interface MachineNotesProps {
  machine: EquipmentMachine;
  clientId: string;
  author: MutationAuthor | null;
  journal?: JournalContext;
  onSaved?: (message: string) => void;
  onError?: (message: string) => void;
  /**
   * Wording for the flag. One field (`isImportant`), one effect (files as
   * CRITICAL, so it reaches the pre-session briefing) — but two honest
   * names for it. From the Equipment tab a trainer is usually reporting
   * kit: "flag for maintenance". Mid-session they are usually recording
   * something about the person on the machine — "hip pain if she goes too
   * fast" is not maintenance, and calling it that would have taught
   * trainers to leave the box unticked on exactly the notes that most need
   * to reach the next trainer.
   */
  flagLabel?: string;
}

export function MachineNotes({
  machine,
  clientId,
  author,
  journal,
  onSaved,
  onError,
  flagLabel = "Flag for maintenance",
}: MachineNotesProps) {
  const [draft, setDraft] = useState("");
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft("");
    setIsMaintenance(false);
  }, [machine.id]);

  const handleAdd = async () => {
    if (!author) {
      onError?.("Trainer session required.");
      return;
    }
    setBusy(true);
    try {
      const note = await addMachineNote({
        clientId,
        machineId: machine.id,
        machineName: machine.name,
        existingNotes: machine.notes,
        content: draft,
        isMaintenance,
        author,
        journal,
      });
      if (note) {
        setDraft("");
        setIsMaintenance(false);
        onSaved?.(
          isMaintenance
            ? "Maintenance note saved — it will show in the pre-session briefing."
            : "Note saved to the client's journal.",
        );
      }
    } catch (err) {
      console.error(err);
      onError?.("Failed to save note.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (noteId?: string) => {
    if (!author || !noteId) return;
    setBusy(true);
    try {
      await deleteMachineNote({
        clientId,
        machineId: machine.id,
        existingNotes: machine.notes,
        noteId,
        author,
      });
    } catch (err) {
      console.error(err);
      onError?.("Failed to remove note.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="eq-card">
      <header className="eq-card__head">
        <h3 className="eq-card__title">
          Notes{machine.notes.length > 0 ? ` (${machine.notes.length})` : ""}
        </h3>
      </header>

      <div className="eq-card__body">
        {machine.notes.length === 0 ? (
          <p className="eq-field__help">
            No notes yet. Anything you add here also files into this client's journal.
          </p>
        ) : (
          <div>
            {[...machine.notes]
              .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
              .map((n) => (
                <article key={n.id} className={`eq-note ${n.isImportant ? "eq-note--flag" : ""}`}>
                  <p className="eq-note__body">{n.content}</p>
                  <div className="eq-note__meta">
                    {n.isImportant && (
                      <span className="eq-note__flag">
                        <Wrench size={11} strokeWidth={2.8} aria-hidden /> Maintenance
                      </span>
                    )}
                    <span>{n.authorName}</span>
                    <span>{formatWhen(n.timestamp)}</span>
                    <button
                      type="button"
                      className="eq-note__del"
                      onClick={() => handleDelete(n.id)}
                      disabled={busy}
                      aria-label="Remove note"
                    >
                      <Trash2 size={14} strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
          </div>
        )}

        <div className="eq-composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Machine issue, sticky seat, client form cue…"
            aria-label="New machine note"
          />
          <div className="eq-composer__row">
            <label className="eq-check">
              <input
                type="checkbox"
                checked={isMaintenance}
                onChange={(e) => setIsMaintenance(e.target.checked)}
              />
              {flagLabel}
            </label>
            <span className="eq-actions__spacer" />
            <button
              type="button"
              className="eq-btn eq-btn--hero"
              onClick={handleAdd}
              disabled={busy || !draft.trim()}
            >
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
              Add note
            </button>
          </div>
          {isMaintenance && (
            <span className="eq-field__help">
              Maintenance notes are marked critical and appear in the pre-session briefing.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
