import { ChevronRight } from "lucide-react";
import { formatStudioTime } from "../../lib/studio-time";
import type { ScheduleRow } from "./adapters";

/**
 * What's coming up. Was "Daily Roster" — renamed so "roster" could mean the
 * Kaizen Roster and only that.
 *
 * Six rows rather than twelve big cards: this section answers "who is next",
 * and a trainer who wants the whole week has the calendar.
 */
export function TodaySchedule({
  rows,
  onSelectClient,
}: {
  rows: ScheduleRow[];
  onSelectClient: (clientId: string) => void;
}) {
  const shown = rows.slice(0, 8);

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2 className="tp-card__title">Upcoming</h2>
        <span className="tp-card__count">{rows.length} booked</span>
      </div>

      {shown.length === 0 ? (
        <div className="tp-card__body">
          <p className="tp-empty">Nothing booked.</p>
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
              <span className={`tp-row__time${row.isToday ? " tp-row__today" : ""}`}>
                {formatStudioTime(row.at)}
              </span>
              <span className="tp-row__main">
                <span className="tp-row__name">{row.clientName}</span>
                <span className="tp-row__sub">
                  {row.isToday
                    ? "Today"
                    : row.at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  {row.sessionNumber != null && ` · Session #${row.sessionNumber}`}
                  {row.remaining != null && ` · ${row.remaining} left`}
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
