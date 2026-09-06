import { describe, it, expect } from "vitest";
import type { Trainer } from "../../types";
import { deriveTrainerStats, relativeDay } from "./stats";

const NOW = Date.UTC(2026, 8, 6, 12);
const stamp = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms });

const withRollups = (rollups: Record<string, unknown> | undefined): Trainer =>
  ({ id: "t1", fullName: "T", initials: "T", role: "LifeTransformer", rollups }) as unknown as Trainer;

describe("deriveTrainerStats", () => {
  it("withholds the lifetime figure until the backfill has run", () => {
    // A counter that started at deploy time, labelled "Sessions Coached",
    // would be a wrong number presented confidently. Better to show nothing.
    const stats = deriveTrainerStats(withRollups({ sessionsCoached: 12, sessionsCoached30d: 12 }), NOW);
    expect(stats.backfilled).toBe(false);
    expect(stats.lifetime).toBeNull();
    expect(stats.last30).toBe(12);
  });

  it("reports the lifetime figure once rollupVersion is stamped", () => {
    const stats = deriveTrainerStats(
      withRollups({ rollupVersion: 1, sessionsCoached: 1284, sessionsCoached30d: 63 }),
      NOW,
    );
    expect(stats.backfilled).toBe(true);
    expect(stats.lifetime).toBe(1284);
  });

  it("reports zero, not null, for a backfilled trainer with no sessions", () => {
    // A new hire has genuinely coached zero. That is a fact, not missing data.
    expect(deriveTrainerStats(withRollups({ rollupVersion: 1 }), NOW).lifetime).toBe(0);
  });

  it("handles a trainer with no rollups at all", () => {
    const stats = deriveTrainerStats(withRollups(undefined), NOW);
    expect(stats).toMatchObject({
      lifetime: null,
      last30: null,
      clients90: null,
      backfilled: false,
      windowsStale: false,
    });
  });

  it("flags windows the nightly job has not refreshed in two days", () => {
    const fresh = deriveTrainerStats(
      withRollups({ sessionsCoached30d: 5, windowsUpdatedAt: stamp(NOW - 3600_000) }),
      NOW,
    );
    const stale = deriveTrainerStats(
      withRollups({ sessionsCoached30d: 5, windowsUpdatedAt: stamp(NOW - 3 * 86_400_000) }),
      NOW,
    );
    expect(fresh.windowsStale).toBe(false);
    expect(stale.windowsStale).toBe(true);
  });

  it("does not call windows stale before the job has ever run", () => {
    // Two warnings about the same missing setup is one warning too many.
    const stats = deriveTrainerStats(withRollups({ windowsUpdatedAt: stamp(NOW - 9e9) }), NOW);
    expect(stats.windowsStale).toBe(false);
  });

  it("ignores non-numeric junk in the counters", () => {
    const stats = deriveTrainerStats(
      withRollups({ rollupVersion: 1, sessionsCoached: "many", sessionsCoached30d: NaN }),
      NOW,
    );
    expect(stats.lifetime).toBe(0);
    expect(stats.last30).toBeNull();
  });
});

describe("relativeDay", () => {
  it("reads the way a person would say it", () => {
    expect(relativeDay(new Date(NOW), NOW)).toBe("today");
    expect(relativeDay(new Date(NOW - 86_400_000), NOW)).toBe("yesterday");
    expect(relativeDay(new Date(NOW - 5 * 86_400_000), NOW)).toBe("5 days ago");
    expect(relativeDay(new Date(NOW - 21 * 86_400_000), NOW)).toBe("3 weeks ago");
    expect(relativeDay(new Date(NOW - 200 * 86_400_000), NOW)).toBe("7 months ago");
    expect(relativeDay(null, NOW)).toBeNull();
  });
});
