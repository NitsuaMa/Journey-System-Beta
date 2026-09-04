/**
 * Small timezone helpers for the cron jobs.
 *
 * Render runs cron schedules in UTC and does not shift them for daylight
 * saving. "0 11 * * *" is 7am Eastern in summer and 6am Eastern in winter. The
 * schedule can't fix that, so the JOB works out what "today" means in the
 * studio's timezone rather than trusting the server clock's idea of a day.
 *
 * Written with Intl rather than a date library because the project has no date
 * dependency and this is the whole of what is needed.
 */

/** Milliseconds to add to a UTC instant to get wall-clock time in `tz`. */
function offsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asIfUtc - at.getTime();
}

/** "2026-09-04" for the given instant, in the given timezone. */
export function ymdIn(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * The instant at which the given local calendar day begins.
 * Two passes: the first guess uses the offset in force at UTC midnight, which
 * is wrong for a few hours a year around a DST switch; re-reading the offset at
 * the guessed instant fixes it.
 */
export function startOfDayIn(tz: string, ymd: string): Date {
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  const firstGuess = new Date(utcMidnight - offsetMs(tz, new Date(utcMidnight)));
  return new Date(utcMidnight - offsetMs(tz, firstGuess));
}

/** Local start of the day `days` before the local day containing `at`. */
export function startOfDaysAgoIn(tz: string, days: number, at: Date = new Date()): Date {
  const todayStart = startOfDayIn(tz, ymdIn(tz, at));
  // Step back in whole days from local midnight, then re-anchor, so a DST
  // change inside the window does not shift the boundary by an hour.
  const rough = new Date(todayStart.getTime() - days * 24 * 60 * 60 * 1000);
  return startOfDayIn(tz, ymdIn(tz, rough));
}

/** Local start of the most recent Monday at or before `at`. */
export function startOfWeekIn(tz: string, at: Date = new Date()): Date {
  const todayYmd = ymdIn(tz, at);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const back = Math.max(0, order.indexOf(weekday));
  return startOfDaysAgoIn(tz, back, startOfDayIn(tz, todayYmd));
}
