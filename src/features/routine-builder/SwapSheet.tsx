/**
 * Swap a machine out, mid-session.
 *
 * Round: Unified Routine Builder, Sep 2026 (follow-up).
 *
 * The reason this exists is the ordinary one: another trainer is on the Leg
 * Press, the client is standing there, and the session has to keep moving.
 * That is not a programming decision and it must not become one — the swap
 * lives in today's session and the client's prescribed routine is untouched.
 *
 * What makes it more than a delete-and-add is the Academy's substitutes
 * table. A Leg Press is not replaced by "some other leg machine"; it is
 * replaced by Leg Extension + Abduction + Lumbar, or by Leg Extension +
 * Lumbar, because those combinations cover what the Leg Press covers. A
 * trainer improvising under time pressure should not have to reconstruct that
 * from memory, and the substitutions that are only half-right are the ones
 * that quietly cost a client their twice-weekly coverage.
 *
 * Sets whose machines are not all on this studio's floor are shown greyed
 * rather than hidden: knowing that the documented answer exists but the
 * equipment is elsewhere is useful, and hiding it looks like the app has no
 * answer at all.
 *
 * A set that is PARTLY in the routine already is still offered, and only its
 * missing members go in. Leg Press substitutes to Leg Extension + Abduction +
 * Lumbar; if the session already runs Leg Extension and Lumbar, the useful
 * action is to put Abduction in the Leg Press's slot, and the coverage is then
 * complete. Blocking that row instead — which is what this did first — leaves
 * a trainer looking at four greyed options and no way forward, on the screen
 * they opened precisely because they needed a way forward.
 */

import { AlertCircle, ArrowRight, Replace } from "lucide-react";
import { cn } from "../../lib/utils";
import { MACHINE_ABBR } from "./academy";
import { substitutesFor } from "./engine";

export interface SwapSheetProps {
  /** The machine being swapped out. */
  machineId: string;
  machineName: (id: string) => string;
  /** Machine ids on this studio's floor. */
  available: string[];
  /** The current sequence, so we never offer something already in it. */
  currentIds: string[];
  /** Replacements, in order, to put where the old machine was. */
  onSwap: (replacements: string[]) => void;
  /** Take it out for today without putting anything in its place. */
  onRemove: () => void;
}

export function SwapSheet({
  machineId,
  machineName,
  available,
  currentIds,
  onSwap,
  onRemove,
}: SwapSheetProps) {
  const documented = substitutesFor(machineId, available);
  const inRoutine = new Set(currentIds);

  const others = available
    .filter((id) => id !== machineId && !inRoutine.has(id))
    .map((id) => ({ id, name: machineName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="rb-swap">
      <p className="rb-note">
        Swapping <strong>{machineName(machineId)}</strong> for today only. The client's saved
        routine does not change.
      </p>

      {documented.length > 0 && (
        <div>
          <div className="rb-sect__label">
            <Replace size={12} aria-hidden />
            Documented substitutes
          </div>
          <div className="rb-swap__list">
            {documented.map((option) => {
              const key = option.machineIds.join("+");
              // What would actually be inserted: the members not already
              // running today. replaceInSequence drops the rest anyway, so
              // this is the honest label for the same action.
              const incoming = option.machineIds.filter(
                (m) => m === machineId || !inRoutine.has(m),
              );
              const partial = incoming.length < option.machineIds.length;
              const usable = option.availableHere && incoming.length > 0;
              return (
                <button
                  key={key}
                  type="button"
                  className={cn("rb-swap__item", !usable && "rb-swap__item--off")}
                  disabled={!usable}
                  onClick={() => onSwap(option.machineIds)}
                >
                  <span className="rb-swap__from">{MACHINE_ABBR[machineId] ?? "—"}</span>
                  <ArrowRight size={13} aria-hidden className="rb-swap__arrow" />
                  <span className="rb-swap__to">
                    {option.machineIds.map((m) => machineName(m)).join("  +  ")}
                  </span>
                  {!option.availableHere ? (
                    <span className="rb-tag rb-tag--clash">not at this studio</span>
                  ) : incoming.length === 0 ? (
                    <span className="rb-tag rb-tag--clash">all already running</span>
                  ) : partial ? (
                    <span className="rb-tag rb-tag--pair">
                      adds {incoming.map((m) => machineName(m)).join(" + ")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="rb-note rb-note--muted" style={{ marginTop: "0.35rem" }}>
            Several machines in place of one is normal here — the set covers between them what the
            single machine covered.
          </p>
        </div>
      )}

      <div>
        <div className="rb-sect__label">Or put something else in its place</div>
        <div className="rb-swap__list">
          {others.map((m) => (
            <button
              key={m.id}
              type="button"
              className="rb-swap__item"
              onClick={() => onSwap([m.id])}
            >
              <span className="rb-swap__from">{MACHINE_ABBR[machineId] ?? "—"}</span>
              <ArrowRight size={13} aria-hidden className="rb-swap__arrow" />
              <span className="rb-swap__to">{m.name}</span>
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="rb-swap__drop" onClick={onRemove}>
        <AlertCircle size={13} aria-hidden />
        Drop {machineName(machineId)} from today with no replacement
      </button>
    </div>
  );
}
