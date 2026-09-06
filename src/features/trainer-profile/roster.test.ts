import { describe, it, expect } from "vitest";
import { KAIZEN_ROSTER_MAX, type KaizenRosterEntry, type Trainer } from "../../types";
import {
  NOTE_MAX,
  addToRoster,
  countByReason,
  isDue,
  isOnRoster,
  removeFromRoster,
  rosterEntryFor,
  sortRoster,
  updateRosterEntry,
} from "./roster";

const NOW = Date.UTC(2026, 8, 6, 12);
const ts = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms }) as any;

const entry = (over: Partial<KaizenRosterEntry> & { clientId: string }): KaizenRosterEntry => ({
  clientName: `Client ${over.clientId}`,
  reason: "Progression",
  addedAt: ts(NOW),
  addedByTrainerId: "aj",
  ...over,
});

describe("addToRoster", () => {
  it("adds a client", () => {
    const result = addToRoster([], entry({ clientId: "c1" }));
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.next).toHaveLength(1);
  });

  it("refuses a duplicate by name, so the message makes sense", () => {
    const result = addToRoster([entry({ clientId: "c1", clientName: "Judy Daus" })], entry({ clientId: "c1", clientName: "Judy Daus" }));
    expect(result.kind).toBe("duplicate");
    expect(result.kind === "duplicate" && result.message).toContain("Judy Daus");
  });

  it("enforces the cap", () => {
    // 40 is not arbitrary: the roster rides on a document streamed to every
    // device, and a roster of 200 is a client list.
    const full = Array.from({ length: KAIZEN_ROSTER_MAX }, (_, i) => entry({ clientId: `c${i}` }));
    const result = addToRoster(full, entry({ clientId: "one-too-many" }));
    expect(result.kind).toBe("full");
  });

  it("truncates an over-long note rather than rejecting the add", () => {
    const result = addToRoster([], entry({ clientId: "c1", note: "x".repeat(500) }));
    expect(result.kind === "ok" && result.next[0].note).toHaveLength(NOTE_MAX);
  });

  it("treats an absent roster as empty", () => {
    expect(addToRoster(undefined, entry({ clientId: "c1" })).kind).toBe("ok");
  });
});

describe("removeFromRoster / updateRosterEntry", () => {
  const list = [entry({ clientId: "c1" }), entry({ clientId: "c2" })];

  it("removes one without touching the rest", () => {
    expect(removeFromRoster(list, "c1").map((e) => e.clientId)).toEqual(["c2"]);
  });

  it("is a no-op for a client who was never on it", () => {
    expect(removeFromRoster(list, "nope")).toHaveLength(2);
  });

  it("patches only the named entry", () => {
    const next = updateRosterEntry(list, "c2", { reason: "Retention", note: "watch attendance" });
    expect(next[0].reason).toBe("Progression");
    expect(next[1].reason).toBe("Retention");
    expect(next[1].note).toBe("watch attendance");
  });

  it("truncates a patched note too", () => {
    const next = updateRosterEntry(list, "c1", { note: "y".repeat(500) });
    expect(next[0].note).toHaveLength(NOTE_MAX);
  });
});

describe("isDue / sortRoster", () => {
  it("is due once the review date has arrived", () => {
    expect(isDue(entry({ clientId: "c1", reviewBy: ts(NOW - 1000) }), NOW)).toBe(true);
    expect(isDue(entry({ clientId: "c1", reviewBy: ts(NOW + 86_400_000) }), NOW)).toBe(false);
    expect(isDue(entry({ clientId: "c1" }), NOW)).toBe(false);
  });

  it("puts due entries first, most overdue at the top", () => {
    const rows = sortRoster(
      [
        entry({ clientId: "fresh", addedAt: ts(NOW) }),
        entry({ clientId: "due-recent", reviewBy: ts(NOW - 86_400_000) }),
        entry({ clientId: "due-old", reviewBy: ts(NOW - 30 * 86_400_000) }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.clientId)).toEqual(["due-old", "due-recent", "fresh"]);
  });

  it("falls back to most recently added, not alphabetical", () => {
    // A working list answers "who am I thinking about", which a name sort
    // cannot express.
    const rows = sortRoster(
      [
        entry({ clientId: "aaa", addedAt: ts(NOW - 10_000) }),
        entry({ clientId: "zzz", addedAt: ts(NOW) }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.clientId)).toEqual(["zzz", "aaa"]);
  });

  it("does not mutate the input", () => {
    const original = [entry({ clientId: "a" }), entry({ clientId: "b", reviewBy: ts(NOW - 1) })];
    const copy = [...original];
    sortRoster(original, NOW);
    expect(original).toEqual(copy);
  });
});

describe("membership lookups", () => {
  const trainer = { kaizenRoster: [entry({ clientId: "c1" })] } as unknown as Trainer;

  it("answers membership for a badge", () => {
    expect(isOnRoster(trainer, "c1")).toBe(true);
    expect(isOnRoster(trainer, "c2")).toBe(false);
    expect(isOnRoster(null, "c1")).toBe(false);
    expect(isOnRoster({} as Trainer, "c1")).toBe(false);
  });

  it("returns the entry itself when one is needed", () => {
    expect(rosterEntryFor(trainer, "c1")?.reason).toBe("Progression");
    expect(rosterEntryFor(trainer, "c2")).toBeNull();
  });
});

describe("countByReason", () => {
  it("summarises the list, busiest reason first", () => {
    const rows = countByReason([
      entry({ clientId: "a", reason: "Form" }),
      entry({ clientId: "b", reason: "Progression" }),
      entry({ clientId: "c", reason: "Form" }),
    ]);
    expect(rows[0]).toEqual({ reason: "Form", count: 2 });
    expect(rows[1]).toEqual({ reason: "Progression", count: 1 });
  });

  it("handles an empty roster", () => {
    expect(countByReason(undefined)).toEqual([]);
  });
});
