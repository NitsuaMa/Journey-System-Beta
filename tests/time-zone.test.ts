import { describe, expect, it } from "vitest";
import {
  startOfDayIn,
  startOfDaysAgoIn,
  startOfWeekIn,
  ymdIn,
} from "../server/time-zone.ts";

/**
 * The cron jobs run on a UTC clock and reason about a studio day in Eastern
 * time, so every one of these cases is a day boundary that a naive
 * "subtract 4 hours" would get wrong twice a year.
 */
const TZ = "America/New_York";

describe("startOfDayIn", () => {
  it("anchors a summer (EDT) day at 04:00 UTC", () => {
    expect(startOfDayIn(TZ, "2026-09-04").toISOString()).toBe("2026-09-04T04:00:00.000Z");
  });

  it("anchors a winter (EST) day at 05:00 UTC", () => {
    expect(startOfDayIn(TZ, "2026-11-02").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("uses the offset in force at local midnight on the day DST ends", () => {
    // Nov 1 2026 starts in EDT and ends in EST. Midnight is still EDT.
    expect(startOfDayIn(TZ, "2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("uses the offset in force at local midnight on the day DST starts", () => {
    // Mar 8 2026 starts in EST; the clocks jump forward at 2am.
    expect(startOfDayIn(TZ, "2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });
});

describe("ymdIn", () => {
  it("is still yesterday locally when UTC has already rolled over", () => {
    expect(ymdIn(TZ, new Date("2026-09-04T03:30:00Z"))).toBe("2026-09-03");
  });
});

describe("startOfWeekIn", () => {
  it("returns the previous Monday when run Sunday evening", () => {
    // 00:00Z Monday = 8pm Sunday Eastern, which is when the coach report runs.
    expect(startOfWeekIn(TZ, new Date("2026-09-07T00:00:00Z")).toISOString()).toBe(
      "2026-08-31T04:00:00.000Z",
    );
  });

  it("returns today when run on a Monday", () => {
    expect(startOfWeekIn(TZ, new Date("2026-09-07T13:00:00Z")).toISOString()).toBe(
      "2026-09-07T04:00:00.000Z",
    );
  });
});

describe("startOfDaysAgoIn", () => {
  it("keeps a whole-day boundary across a DST change", () => {
    expect(startOfDaysAgoIn(TZ, 7, new Date("2026-11-05T15:00:00Z")).toISOString()).toBe(
      "2026-10-29T04:00:00.000Z",
    );
  });
});
