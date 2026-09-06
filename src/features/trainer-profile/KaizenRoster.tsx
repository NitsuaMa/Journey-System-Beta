import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Client, ScheduleEntry, Trainer } from "../../types";
import { KAIZEN_ROSTER_MAX } from "../../types";
import { AddToRosterDialog } from "./AddToRosterDialog";
import { KaizenMark } from "./KaizenMark";
import { KaizenRosterRow } from "./KaizenRosterRow";
import { useKaizenRoster } from "./useKaizenRoster";
import { countByReason, sortRoster } from "./roster";
import { scheduleInstant } from "./adapters";

/**
 * The Kaizen Roster panel.
 *
 * Sits ABOVE the schedule on the profile, deliberately: the schedule answers
 * "what is next", the roster answers "who am I actually working on", and the
 * second question is the one a profile page exists for.
 *
 * Everyone at the studio can read it — that is the point, it is how you pick
 * up a colleague's client when they are out. Only its owner can change it,
 * enforced in firestore.rules, not just here.
 */
export function KaizenRoster({
  trainer,
  clients,
  schedules,
  canEdit,
  onSelectClient,
}: {
  trainer: Trainer;
  clients: Client[];
  schedules: ScheduleEntry[];
  canEdit: boolean;
  onSelectClient: (clientId: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const { add, remove, saving } = useKaizenRoster(trainer);

  const rows = useMemo(() => sortRoster(trainer.kaizenRoster), [trainer.kaizenRoster]);
  const summary = useMemo(() => countByReason(trainer.kaizenRoster), [trainer.kaizenRoster]);
  const onRoster = useMemo(
    () => new Set((trainer.kaizenRoster ?? []).map((e) => e.clientId)),
    [trainer.kaizenRoster],
  );

  /** Soonest future booking per client, so a row can say "Next Tue". */
  const nextByClient = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, Date>();
    for (const s of schedules) {
      if (!s.clientId || s.status === "Cancelled" || s.status === "Completed") continue;
      const at = scheduleInstant(s);
      if (!at || at.getTime() < now) continue;
      const current = map.get(s.clientId);
      if (!current || at < current) map.set(s.clientId, at);
    }
    return map;
  }, [schedules]);

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2 className="tp-card__title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <KaizenMark size={15} />
          Kaizen Roster
        </h2>
        <span className="tp-card__count">
          {rows.length} tracked
          {rows.length >= KAIZEN_ROSTER_MAX && " · full"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="tp-card__body">
          <p className="tp-empty" style={{ marginBottom: canEdit ? 12 : 0 }}>
            {canEdit
              ? "Nobody tracked yet. Add the clients you're actively working on — a progression you're pushing, form you're watching, someone coming back from a layoff."
              : "Nobody tracked yet."}
          </p>
          {canEdit && (
            <button type="button" className="tp-btn tp-btn--primary" onClick={() => setAddOpen(true)}>
              <Plus size={15} aria-hidden />
              Add to roster
            </button>
          )}
        </div>
      ) : (
        <>
          {summary.length > 0 && (
            <div className="tp-card__body" style={{ paddingBottom: 0 }}>
              <div className="tp-tags">
                {summary.map(({ reason, count }) => (
                  <span key={reason} className="tp-chip">
                    {reason} {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="tp-rows" style={{ marginTop: 12 }}>
            {rows.map((entry) => (
              <KaizenRosterRow
                key={entry.clientId}
                entry={entry}
                nextSessionAt={nextByClient.get(entry.clientId) ?? null}
                canEdit={canEdit}
                onOpen={onSelectClient}
                onRemove={remove}
              />
            ))}
          </div>

          {canEdit && (
            <div className="tp-card__body" style={{ paddingTop: 12 }}>
              <button
                type="button"
                className="tp-btn"
                onClick={() => setAddOpen(true)}
                disabled={rows.length >= KAIZEN_ROSTER_MAX}
              >
                <Plus size={15} aria-hidden />
                Add to roster
              </button>
            </div>
          )}
        </>
      )}

      {canEdit && (
        <AddToRosterDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          clients={clients}
          alreadyOnRoster={onRoster}
          onAdd={(client, reason, options) => add(client, reason, options)}
          saving={saving}
        />
      )}
    </section>
  );
}
