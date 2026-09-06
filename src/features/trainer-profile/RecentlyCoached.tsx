import { ChevronRight } from "lucide-react";
import type { CoachedRow } from "./adapters";

/**
 * Sessions this trainer has finished. Was "Recently Logged / Historical
 * Sessions", and its empty state said "No recent activity recorded." — which
 * was true of the 24 hours the app had loaded and false of the trainer.
 *
 * The empty state now names the window it actually checked, so an empty list
 * reads as information rather than as a bug.
 */
export function RecentlyCoached({
  rows,
  windowLabel,
  onSelectClient,
}: {
  rows: CoachedRow[];
  windowLabel: string;
  onSelectClient: (clientId: string) => void;
}) {
  const shown = rows.slice(0, 8);

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2 className="tp-card__title">Recently coached</h2>
        <span className="tp-card__count">{windowLabel}</span>
      </div>

      {shown.length === 0 ? (
        <div className="tp-card__body">
          <p className="tp-empty">No sessions completed in {windowLabel.toLowerCase()}.</p>
        </div>
      ) : (
        <div className="tp-rows">
          {shown.map((row) => (
            <button
              key={row.id}
              type="button"
              className="tp-row"
              onClick={() => row.clientId && onSelectClient(row.clientId)}
              disabled={!row.clientId}
            >
              <span className="tp-row__main">
                <span className="tp-row__name">{row.clientName}</span>
                <span className="tp-row__sub">
                  {row.at.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </span>
              <ChevronRight size={16} aria-hidden style={{ opacity: 0.5, flex: "0 0 auto" }} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
