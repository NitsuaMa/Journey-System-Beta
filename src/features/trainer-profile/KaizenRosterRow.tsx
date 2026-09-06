import { ChevronRight, X } from "lucide-react";
import { toDate } from "../../lib/studio-time";
import type { KaizenRosterEntry } from "../../types";
import { KaizenMark } from "./KaizenMark";
import { isDue } from "./roster";

/**
 * One client on the roster.
 *
 * Reason chip first, because that is what makes the list scannable — twelve
 * names tells you nothing, twelve names each labelled Progression / Form /
 * Return is a working plan. The note is secondary and truncates; a note long
 * enough to need wrapping belongs in the client's Journal.
 */
export function KaizenRosterRow({
  entry,
  nextSessionAt,
  canEdit,
  onOpen,
  onRemove,
}: {
  entry: KaizenRosterEntry;
  nextSessionAt: Date | null;
  canEdit: boolean;
  onOpen: (clientId: string) => void;
  onRemove: (clientId: string) => void;
}) {
  const due = isDue(entry);
  const reviewBy = toDate(entry.reviewBy);

  const sub = [
    entry.note,
    nextSessionAt
      ? `Next ${nextSessionAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
      : "Nothing booked",
    due && reviewBy
      ? `Review due ${reviewBy.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="tp-row" style={{ cursor: "default" }}>
      <KaizenMark size={16} quiet={!due} />

      <button
        type="button"
        className="tp-row__main"
        onClick={() => onOpen(entry.clientId)}
        style={{ background: "none", border: 0, padding: 0, font: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        <span className="tp-row__name">{entry.clientName}</span>
        <span className="tp-row__sub">{sub}</span>
      </button>

      <span className="tp-chip tp-chip--kaizen">{entry.reason}</span>

      {canEdit ? (
        <button
          type="button"
          className="tp-btn tp-btn--ghost"
          style={{ minHeight: 34, padding: "0 8px" }}
          onClick={() => onRemove(entry.clientId)}
          aria-label={`Remove ${entry.clientName} from your Kaizen Roster`}
          title="Remove from roster"
        >
          <X size={15} aria-hidden />
        </button>
      ) : (
        <ChevronRight size={16} aria-hidden style={{ opacity: 0.5, flex: "0 0 auto" }} />
      )}
    </div>
  );
}
