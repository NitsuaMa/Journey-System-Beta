/**
 * Render Cron Job entry point: nightly leaderboard materialisation.
 *
 * The work itself has lived in server/leaderboard-cron.ts for a while with no
 * scheduler attached to it. This file is the two lines that let Render run it.
 *
 * Schedule: 0 7 * * *  (07:00 UTC = 3am Eastern in summer, 2am in winter)
 */

import { runCron } from "./cron-runtime.ts";
import { calculateLeaderboards } from "./leaderboard-cron.ts";

void runCron("cron-leaderboards", calculateLeaderboards);
