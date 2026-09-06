import { describe, it, expect } from "vitest";
import {
  planRollup,
  tallyWindows,
  sessionInstantMs,
  foldBackfillPage,
  type BackfillTotals,
  type SessionLike,
} from "./trainerRollups";

describe("planRollup", () => {
  it("counts a session the first time it completes", () => {
    expect(planRollup({ status: "In-Progress" }, { status: "Completed" })).toEqual({ kind: "count" });
  });

  it("does not count the same completion twice", () => {
    // Cloud Functions deliver at least once, so this is the case that keeps
    // a retry from inflating a trainer's career total.
    const after: SessionLike = { status: "Completed", rollupCounted: true, rollupTrainerId: "t1" };
    expect(planRollup(after, after)).toEqual({ kind: "none", reason: "already counted" });
  });

  it("ignores a session that is still in progress", () => {
    expect(planRollup(undefined, { status: "In-Progress" })).toEqual({
      kind: "none",
      reason: "not completed",
    });
  });

  it("reverses the count when a completed session is reopened", () => {
    const before: SessionLike = { status: "Completed", rollupCounted: true, rollupTrainerId: "t1" };
    const after: SessionLike = { status: "In-Progress", rollupCounted: true, rollupTrainerId: "t1" };
    expect(planRollup(before, after)).toEqual({ kind: "uncount", trainerId: "t1" });
  });

  it("reverses the count when a counted session is deleted", () => {
    const before: SessionLike = { status: "Completed", rollupCounted: true, rollupTrainerId: "t7" };
    expect(planRollup(before, undefined)).toEqual({ kind: "uncount", trainerId: "t7" });
  });

  it("does nothing when an uncounted session is deleted", () => {
    // Discarding an in-progress session is routine; it must not move a total.
    expect(planRollup({ status: "In-Progress" }, undefined)).toEqual({
      kind: "none",
      reason: "deleted; never counted",
    });
  });

  it("does not reverse a counted session with no recorded trainer", () => {
    const before: SessionLike = { status: "Completed", rollupCounted: true };
    expect(planRollup(before, undefined).kind).toBe("none");
  });
});

describe("tallyWindows", () => {
  const now = Date.UTC(2026, 8, 6);
  const daysAgo = (n: number) => now - n * 86_400_000;

  it("splits 30-day and 90-day counts", () => {
    const rows = [
      { atMs: daysAgo(1), clientId: "c1" },
      { atMs: daysAgo(29), clientId: "c2" },
      { atMs: daysAgo(45), clientId: "c1" },
      { atMs: daysAgo(120), clientId: "c9" },
    ];
    const t = tallyWindows(rows, now);
    expect(t.sessions30d).toBe(2);
    expect(t.sessions90d).toBe(3);
  });

  it("counts distinct clients, not sessions", () => {
    const rows = [
      { atMs: daysAgo(1), clientId: "c1" },
      { atMs: daysAgo(2), clientId: "c1" },
      { atMs: daysAgo(3), clientId: "c2" },
    ];
    expect(tallyWindows(rows, now).clients90d).toBe(2);
  });

  it("ignores sessions with no client when counting clients", () => {
    const rows = [{ atMs: daysAgo(1) }, { atMs: daysAgo(2), clientId: "c1" }];
    expect(tallyWindows(rows, now).clients90d).toBe(1);
  });

  it("averages over the window, not over all time", () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({ atMs: daysAgo(i % 90) }));
    // 130 sessions across ~12.86 weeks
    expect(tallyWindows(rows, now).avgPerWeek).toBeCloseTo(10.1, 1);
  });

  it("returns zeroes for a trainer with nothing in the window", () => {
    expect(tallyWindows([], now)).toEqual({
      sessions30d: 0,
      sessions90d: 0,
      clients90d: 0,
      avgPerWeek: 0,
    });
  });
});

describe("sessionInstantMs", () => {
  it("prefers createdAt", () => {
    const ms = Date.UTC(2026, 0, 2);
    expect(sessionInstantMs({ createdAt: { toMillis: () => ms }, date: "2020-01-01" })).toBe(ms);
  });

  it("falls back to the date string for imported rows", () => {
    expect(sessionInstantMs({ date: "2026-03-04" })).toBe(Date.parse("2026-03-04"));
  });

  it("returns null when neither is usable", () => {
    expect(sessionInstantMs({ date: "not a date" })).toBeNull();
    expect(sessionInstantMs({})).toBeNull();
  });
});

describe("foldBackfillPage", () => {
  const index = new Map([["AJ", "trainer-aj"]]);

  it("credits explicit ids and skips incomplete sessions", () => {
    const totals = new Map<string, BackfillTotals>();
    const res = foldBackfillPage(
      totals,
      [
        { status: "Completed", trainerId: "t1", date: "2026-01-05" },
        { status: "Completed", trainerId: "t1", date: "2026-02-05" },
        { status: "In-Progress", trainerId: "t1" },
      ],
      index,
    );
    expect(res.counted).toBe(2);
    expect(totals.get("t1")?.sessionsCoached).toBe(2);
    expect(totals.get("t1")?.firstSessionAtMs).toBe(Date.parse("2026-01-05"));
    expect(totals.get("t1")?.lastSessionAtMs).toBe(Date.parse("2026-02-05"));
  });

  it("resolves legacy rows by initials", () => {
    const totals = new Map<string, BackfillTotals>();
    foldBackfillPage(totals, [{ status: "Completed", trainerInitials: "aj" }], index);
    expect(totals.get("trainer-aj")?.sessionsCoached).toBe(1);
  });

  it("reports rows it cannot credit instead of guessing", () => {
    const totals = new Map<string, BackfillTotals>();
    const res = foldBackfillPage(totals, [{ status: "Completed", trainerInitials: "ZZ" }], index);
    expect(res.unresolved).toBe(1);
    expect(totals.size).toBe(0);
  });

  it("accumulates across pages", () => {
    const totals = new Map<string, BackfillTotals>();
    foldBackfillPage(totals, [{ status: "Completed", trainerId: "t1" }], index);
    foldBackfillPage(totals, [{ status: "Completed", trainerId: "t1" }], index);
    expect(totals.get("t1")?.sessionsCoached).toBe(2);
  });
});
