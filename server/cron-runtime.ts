/**
 * Shared wrapper for every cron entry point.
 *
 * Render decides whether a cron run succeeded purely from the process exit
 * code: 0 is green, anything else is a failed run you can see (and alert on) in
 * the dashboard. A script that swallows its own error and returns normally
 * reports success forever while doing nothing, so everything here funnels into
 * an explicit process.exit.
 */

import dotenv from "dotenv";

dotenv.config();

export async function runCron(name: string, job: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  console.log(`[${name}] started ${new Date().toISOString()}`);

  try {
    await job();
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[${name}] finished OK in ${seconds}s`);
    // Firestore keeps gRPC channels open; without an explicit exit the process
    // can idle for another 30-60s and Render bills the whole time.
    process.exit(0);
  } catch (err) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`[${name}] FAILED after ${seconds}s:`, err);
    process.exit(1);
  }
}
