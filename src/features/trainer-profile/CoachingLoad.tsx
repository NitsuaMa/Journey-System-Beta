import { AlertTriangle } from "lucide-react";
import type { TrainerStats } from "./stats";
import { relativeDay } from "./stats";

/**
 * The four numbers. This is what "Total Ops Vol: 0 Logged Sessions" becomes.
 *
 * The headline moves depending on what can be trusted. Once the admin
 * backfill has run, it is the lifetime total. Before that it is the 30-day
 * figure, with a line saying the history has not been counted yet — because
 * the alternative is labelling "sessions since we deployed a trigger" as a
 * career total and hoping nobody notices.
 */
export function CoachingLoad({ stats }: { stats: TrainerStats }) {
  const value = (n: number | null) => (n === null ? "—" : n.toLocaleString());
  const last = relativeDay(stats.lastSessionAt);

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2 className="tp-card__title">Coaching load</h2>
        {last && <span className="tp-card__count">Last session {last}</span>}
      </div>

      <div className="tp-stats">
        {stats.backfilled ? (
          <div className="tp-stat tp-stat--hero">
            <span className="tp-stat__v">{value(stats.lifetime)}</span>
            <span className="tp-stat__k">Sessions coached</span>
          </div>
        ) : (
          <div className="tp-stat tp-stat--hero">
            <span className="tp-stat__v">{value(stats.last30)}</span>
            <span className="tp-stat__k">Last 30 days</span>
            <span className="tp-stat__note">Lifetime not counted yet</span>
          </div>
        )}

        {stats.backfilled && (
          <div className="tp-stat">
            <span className="tp-stat__v">{value(stats.last30)}</span>
            <span className="tp-stat__k">Last 30 days</span>
          </div>
        )}

        <div className="tp-stat">
          <span className="tp-stat__v">{value(stats.clients90)}</span>
          <span className="tp-stat__k">Clients</span>
          <span className="tp-stat__note">Last 90 days</span>
        </div>

        <div className="tp-stat">
          <span className="tp-stat__v">
            {stats.avgPerWeek === null ? "—" : stats.avgPerWeek.toFixed(1)}
          </span>
          <span className="tp-stat__k">Per week</span>
          <span className="tp-stat__note">90-day average</span>
        </div>
      </div>

      {(!stats.backfilled || stats.windowsStale) && (
        <div className="tp-card__body" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <p className="tp-empty" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={14} aria-hidden />
            {!stats.backfilled
              ? "Session history hasn't been counted yet. An admin can run it once from Admin › System Backend › System Tools."
              : "These windows are recalculated nightly and haven't refreshed in over two days."}
          </p>
        </div>
      )}
    </section>
  );
}
