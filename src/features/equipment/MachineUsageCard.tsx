import { memo } from "react";
import type { EquipmentMachine } from "./types";

/**
 * History — what the client has actually done on this machine.
 *
 * The Prescription card above it is about intent (starting → current). This
 * card is about evidence: when the machine was first performed, how many
 * sessions have included it, when it was last used, and how far the load has
 * moved since that first day. Four numbers, one line each, because a trainer
 * glances at this between clients — it is not a report.
 *
 * "Progression" is measured from the FIRST LOAD EVER PERFORMED, not the
 * prescription's starting weight, because the two can differ (a starting
 * weight is sometimes typed in months later from memory) and only one of them
 * is a fact that happened on the floor.
 */

const day = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const ago = (iso: string | null, now = Date.now()): string | null => {
  if (!iso) return null;
  const t = new Date(`${iso}T12:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.round((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 yr ago" : `${years} yrs ago`;
};

export const MachineUsageCard = memo(function MachineUsageCard({ machine }: { machine: EquipmentMachine }) {
  const u = machine.usage;
  const never = u.timesPerformed === 0 && !u.firstPerformed;
  const pct = u.progressionPct;
  const progressClass = pct === null ? "eq-use__value--empty" : pct > 0 ? "eq-use__value--up" : pct < 0 ? "eq-use__value--down" : "";
  const from = u.firstWeight;
  const to = machine.currentWeight ?? u.lastWeight;

  return (
    <section className="eq-card" aria-label="Training history">
      <header className="eq-card__head">
        <h3 className="eq-card__title">History</h3>
        {u.partial && !never && (
          <span className="eq-use__partial" title="Lifetime figures are being built from the full session history and will replace these shortly.">
            from loaded sessions
          </span>
        )}
      </header>
      <div className="eq-card__body">
        {never ? (
          <p className="eq-use__never">
            {machine.startingWeight !== null || machine.isConfigured
              ? "Set up, but no set has been logged on it yet."
              : "Never performed by this client."}
          </p>
        ) : (
          <dl className="eq-use">
            <div className="eq-use__stat">
              <dt className="eq-rx__label">First performed</dt>
              <dd className="eq-use__value">{day(u.firstPerformed)}</dd>
              <dd className="eq-use__sub">{ago(u.firstPerformed) ?? ""}</dd>
            </div>
            <div className="eq-use__stat">
              <dt className="eq-rx__label">Times performed</dt>
              <dd className="eq-use__value">
                {u.timesPerformed}
                <small>{u.timesPerformed === 1 ? "session" : "sessions"}</small>
              </dd>
              <dd className="eq-use__sub">{machine.loggedSetCount > 0 ? `${machine.loggedSetCount} set${machine.loggedSetCount === 1 ? "" : "s"} loaded` : ""}</dd>
            </div>
            <div className="eq-use__stat">
              <dt className="eq-rx__label">Last performed</dt>
              <dd className="eq-use__value">{day(u.lastPerformed)}</dd>
              <dd className="eq-use__sub">{ago(u.lastPerformed) ?? ""}</dd>
            </div>
            <div className="eq-use__stat">
              <dt className="eq-rx__label">Avg. time under tension</dt>
              <dd className="eq-use__value">
                {u.averageTutSeconds === null ? (
                  "—"
                ) : (
                  <>
                    {u.averageTutSeconds}
                    <small>sec / set</small>
                  </>
                )}
              </dd>
              <dd className="eq-use__sub">
                {u.tutSamples > 0
                  ? `across ${u.tutSamples} timed set${u.tutSamples === 1 ? "" : "s"}`
                  : "no set has been timed yet"}
              </dd>
            </div>
            <div className="eq-use__stat eq-use__stat--prog">
              <dt className="eq-rx__label">Progression</dt>
              <dd className={`eq-use__value ${progressClass}`}>{pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}</dd>
              <dd className="eq-use__sub">
                {from !== null && to !== null ? (
                  <>
                    {from} <span aria-hidden="true">→</span> {to} lb since first set
                  </>
                ) : (
                  "needs a first and a current load"
                )}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
});
