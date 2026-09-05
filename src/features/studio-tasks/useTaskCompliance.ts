/**
 * Was the list actually done, over the last N studio days?
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * THE QUESTION A MANAGER HAS AND A TRAINER DOES NOT
 * ------------------------------------------------
 * The board answers "what is left today", which is the right question for
 * someone standing on the floor. A studio manager - and the brief called out
 * the ones who administrate without training clients - has a different one:
 * "is closing actually getting done on Sundays?" That is not visible in any
 * single day's list, and it is the whole reason this hook exists.
 *
 * DERIVED, NOT STORED
 * -------------------
 * planDay() is pure, so the plan for a past day can simply be recomputed. The
 * instances are the record of ACTION against that plan, and their absence is
 * meaningful: a planned row with no document was never touched. That is why
 * the lazy-write design in mutations.ts costs nothing here — a missed task
 * looks exactly like what it is.
 *
 * ONE RANGE QUERY, NO COMPOSITE INDEX
 * -----------------------------------
 * A range on a single field is covered by Firestore's automatic index, so this
 * deploys with nothing to configure. A query that needs a composite index
 * fails quietly in the console and loudly on the floor, which is a bad trade
 * for a panel a manager opens once a week.
 */

import { useEffect, useMemo, useState } from "react";
import { getDocs, query, where } from "firebase/firestore";
import { studioDateKey } from "../../lib/studio-time";
import { useStudioMachines } from "../../hooks/useStudioMachines";
import { instancesRef } from "./mutations";
import { planDay } from "./recurrence";
import type { TaskInstance, TaskTemplate } from "./types";

export interface ComplianceCell {
  dateKey: string;
  planned: number;
  done: number;
  flagged: number;
}

export interface ComplianceRow {
  template: TaskTemplate;
  cells: ComplianceCell[];
  /** Days the template was due at all. A template that never came due is not
   *  failing; it simply had nothing to do. */
  dueDays: number;
  doneDays: number;
}

/** The last `days` studio-local date keys, oldest first. */
export function recentDateKeys(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = studioDateKey(d);
    if (key) out.push(key);
  }
  return out;
}

export function useTaskCompliance(
  studioId: string | null,
  templates: TaskTemplate[],
  days = 7,
) {
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(false);

  const dateKeys = useMemo(() => recentDateKeys(days), [days]);
  const from = dateKeys[0];
  const to = dateKeys[dateKeys.length - 1];

  const { machines } = useStudioMachines(studioId, {
    bridgeWhenRosterEmpty: true,
  });
  const machineIds = useMemo(() => machines.map((m) => m.machineId), [machines]);

  useEffect(() => {
    if (!studioId || !from || !to) {
      setInstances([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // A one-shot read, not a subscription: this is a review panel, not a live
    // board, and a manager reading last week does not need it to tick over.
    getDocs(
      query(
        instancesRef(studioId),
        where("localDate", ">=", from),
        where("localDate", "<=", to),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        setInstances(
          snap.docs.map(
            (d) => ({ ...(d.data() as Omit<TaskInstance, "id">), id: d.id }),
          ),
        );
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading task compliance:", err);
        if (!cancelled) {
          setInstances([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studioId, from, to]);

  const rows = useMemo<ComplianceRow[]>(() => {
    const byId = new Map<string, TaskInstance>();
    for (const i of instances) byId.set(i.id, i);

    // Studio templates only. A trainer's private list is not something a
    // manager reviews - see TaskScope in types.ts.
    const studioTemplates = templates.filter((t) => t.scope !== "personal");

    return studioTemplates
      .map((template) => {
        let dueDays = 0;
        let doneDays = 0;

        const cells = dateKeys.map((dateKey) => {
          const planned = planDay([template], dateKey, machineIds);
          let done = 0;
          let flagged = 0;
          for (const p of planned) {
            const inst = byId.get(p.id);
            if (inst?.status === "done" || inst?.status === "skipped") done += 1;
            if (inst?.flagged) flagged += 1;
          }
          if (planned.length > 0) {
            dueDays += 1;
            if (done === planned.length) doneDays += 1;
          }
          return { dateKey, planned: planned.length, done, flagged };
        });

        return { template, cells, dueDays, doneDays };
      })
      // Worst first: the point of the panel is to surface what is slipping,
      // and a manager should not have to scan a green wall to find the red.
      .sort((a, b) => {
        const rate = (r: ComplianceRow) =>
          r.dueDays === 0 ? 2 : r.doneDays / r.dueDays;
        return rate(a) - rate(b);
      });
  }, [templates, instances, dateKeys, machineIds]);

  return { rows, dateKeys, loading };
}
