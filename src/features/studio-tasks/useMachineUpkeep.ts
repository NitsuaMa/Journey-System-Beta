import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { instancesRef } from "./mutations";
import { upkeepRoleOf } from "./types";
import type { StudioTaskCategory, TaskInstance } from "./types";

export interface MachineUpkeep {
  /** Most recent completed cleaning task for this machine, if any. */
  lastCleaned?: TaskInstance;
  /** Most recent completed maintenance task. */
  lastServiced?: TaskInstance;
  /** An open problem someone reported and no manager has cleared. */
  flagged?: TaskInstance;
}

/**
 * Cleaning and maintenance state per machine, for the Catalog.
 *
 * Round: Studio To-Do, Sep 2026.
 *
 * Derived from task instances rather than from the roster, because the roster
 * is manager-write and the person who notices a broken pad is a trainer. See
 * TaskNoteDialog for the full reasoning.
 *
 * Scoped to machine-kind instances only, and read whole rather than per machine:
 * one listener for a studio beats twenty-two that re-subscribe on every tap.
 */
export function useMachineUpkeep(
  studioId: string | null,
  /**
   * The studio's categories. Optional, and the omission is safe: upkeepRoleOf
   * falls back to the built-in ids, which is what every studio that has never
   * renamed a category still uses. Pass them and a studio that renamed
   * "Cleaning" to "Wipe-down" keeps its Last cleaned row.
   */
  studioCategories?: StudioTaskCategory[],
) {
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studioId) {
      setInstances([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(instancesRef(studioId), where("kind", "==", "machine")),
      (snap) => {
        setInstances(
          snap.docs.map(
            (d) => ({ ...(d.data() as Omit<TaskInstance, "id">), id: d.id }),
          ),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading machine upkeep:", err);
        setInstances([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [studioId]);

  const byMachineId = useMemo(() => {
    const map: Record<string, MachineUpkeep> = {};
    // localDate sorts lexicographically because it is YYYY-MM-DD — no date
    // parsing needed, and no dependence on completedAt, which is a server
    // timestamp that reads back null for a moment after a write.
    const sorted = [...instances].sort((a, b) =>
      b.localDate.localeCompare(a.localDate),
    );

    for (const i of sorted) {
      if (!i.machineId) continue;
      const entry = (map[i.machineId] ??= {});

      if (i.flagged && i.status !== "skipped" && !entry.flagged) {
        entry.flagged = i;
      }
      if (i.status === "done") {
        // Resolved through the category rather than matched on the literal
        // string: categories are studio-authored as of Sep 2026, and a
        // hard-coded "cleaning" would silently empty this row the first time
        // a manager renamed it. See upkeepRoleOf in types.ts.
        const role = upkeepRoleOf(i.category, studioCategories);
        if (role === "cleaning" && !entry.lastCleaned) entry.lastCleaned = i;
        if (role === "maintenance" && !entry.lastServiced) {
          entry.lastServiced = i;
        }
      }
    }
    return map;
  }, [instances, studioCategories]);

  return { byMachineId, loading };
}
