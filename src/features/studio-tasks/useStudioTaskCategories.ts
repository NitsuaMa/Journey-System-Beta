/**
 * A studio's own labels for its work.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Returns the built-ins merged with whatever the studio authored, so a studio
 * that has never opened the category editor still gets a sensible four and
 * never sees an empty picker. A studio-authored document with a built-in id
 * WINS — that is how a manager renames "Cleaning" to "Wipe-down" while
 * keeping the upkeep behaviour the built-in id carries.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { categoriesRef } from "./mutations";
import { BUILT_IN_CATEGORIES, type StudioTaskCategory } from "./types";

export function useStudioTaskCategories(studioId: string | null) {
  const [authored, setAuthored] = useState<StudioTaskCategory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studioId) {
      setAuthored([]);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      categoriesRef(studioId),
      (snap) => {
        setAuthored(
          snap.docs.map(
            (d) => ({ ...(d.data() as Omit<StudioTaskCategory, "id">), id: d.id }),
          ),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading studio task categories:", err);
        setAuthored([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [studioId]);

  const categories = useMemo(() => {
    const byId = new Map<string, StudioTaskCategory>();
    for (const c of BUILT_IN_CATEGORIES) byId.set(c.id, c);
    // Authored last so a studio's rename of a built-in id overrides it.
    for (const c of authored) {
      const base = byId.get(c.id);
      byId.set(c.id, base ? { ...base, ...c } : c);
    }
    return [...byId.values()].sort(
      (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label),
    );
  }, [authored]);

  return { categories, authored, loading };
}
