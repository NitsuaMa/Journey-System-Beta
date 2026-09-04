/**
 * Nightly leaderboard materialisation. Runs as a Render Cron Job via
 * server/cron-leaderboards.ts.
 *
 * Credentials and the named-database handle now come from ./firebase-admin.ts.
 * This file used to call admin.initializeApp({ projectId }) with no credential
 * at all, which works on a machine with Application Default Credentials and
 * nowhere else — on Render it would have thrown on the first read.
 */
import { getDb } from './firebase-admin.ts';

export async function calculateLeaderboards() {
  const cronId = Math.random().toString(36).substring(7);
  console.log(`[LeaderboardCron-${cronId}] Starting nighty calculation...`);

  const database = getDb();

  try {
    // 1. Fetch all active clients
    console.log(`[LeaderboardCron-${cronId}] Fetching active clients...`);
    const clientsSnap = await database.collection('clients').where('isActive', '==', true).get();
    const activeClients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const clientMap = new Map<string, any>(activeClients.map(c => [c.id, c]));

    // 2. Fetch all machines to ensure we have the full set
    const machinesSnap = await database.collection('machines').get();
    const machines = machinesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // 3. Process logs in batches to avoid memory/quota issues
    console.log(`[LeaderboardCron-${cronId}] Scanning exercise logs...`);
    
    // We group by machineId -> clientId -> maxWeight
    const globalStandings: Record<string, Record<string, number>> = {};
    
    // Initialize standings for each machine
    machines.forEach(m => {
      globalStandings[m.id] = {};
    });

    // Fetch logs - In a huge DB we'd use pagination/startAfter
    // For this app, we'll fetch all logs that have a weight
    const logsSnap = await database.collection('exerciseLogs').orderBy('weight', 'desc').get();
    
    console.log(`[LeaderboardCron-${cronId}] Processing ${logsSnap.size} logs...`);

    logsSnap.forEach(doc => {
      const log = doc.data();
      const weight = parseFloat(log.weight);
      if (isNaN(weight) || weight <= 0) return;

      const clientId = log.clientId;
      const machineId = log.machineId;

      if (!clientId || !machineId || !globalStandings[machineId]) return;

      // Only care about active clients
      if (!clientMap.has(clientId)) return;

      // We only keep the maximum weight seen for this client on this machine
      const currentMax = globalStandings[machineId][clientId] || 0;
      if (weight > currentMax) {
        globalStandings[machineId][clientId] = weight;
      }
    });

    // 4. Transform and Rank
    console.log(`[LeaderboardCron-${cronId}] Calculating rankings and percentiles...`);
    const machineData: Record<string, any> = {};

    for (const machineId of Object.keys(globalStandings)) {
      const clientWeights = globalStandings[machineId];
      const sortedEntries = Object.entries(clientWeights)
        .sort(([, a], [, b]) => b - a); // Descending weight

      const rankings = sortedEntries.map(([clientId, weight], index) => {
        const client = clientMap.get(clientId);
        return {
          clientId,
          clientName: `${client.firstName} ${client.lastName}`,
          weight,
          rank: index + 1,
          percentile: Math.round(((sortedEntries.length - index) / sortedEntries.length) * 100)
        };
      });

      // Percentile Thresholds
      const weights = sortedEntries.map(([, w]) => w);
      const getPercentileValue = (p: number) => {
        if (weights.length === 0) return 0;
        const index = Math.floor((1 - p/100) * (weights.length - 1));
        return Math.round(weights[index]);
      };

      const thresholds = {
        p90: getPercentileValue(90),
        p75: getPercentileValue(75),
        p50: getPercentileValue(50),
        p25: getPercentileValue(25),
        p10: getPercentileValue(10)
      };

      // Also store individual client placements for quick "Your Percentile" O(1) lookups
      const clientPlacements: Record<string, any> = {};
      rankings.forEach(r => {
        clientPlacements[r.clientId] = {
          weight: r.weight,
          rank: r.rank,
          percentile: r.percentile
        };
      });

      machineData[machineId] = {
        topPerformers: rankings.slice(0, 50), // Store top 50 for quick leaderboard
        stats: {
          count: sortedEntries.length,
          avg: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0,
           max: weights.length ? weights[0] : 0,
          min: weights.length ? weights[weights.length - 1] : 0,
          buckets: calculateBuckets(weights)
        },
        percentileThresholds: thresholds,
        clientPlacements
      };
    }

    // 5. Save Materialized View
    const lastUpdated = new Date().toISOString();
    
    // Global Leaderboard
    await database.collection('leaderboards').doc('global').set({
      lastUpdated,
      scope: 'global',
      machineData
    });

    // 6. Studio-Specific Leaderboards (if requested)
    const studioIds = [...new Set(activeClients.map(c => c.homeStudioId).filter(Boolean))];
    for (const studioId of studioIds) {
      const studioMachineData: Record<string, any> = {};
      
      for (const machineId of Object.keys(globalStandings)) {
        const studioClientWeights: Record<string, number> = {};
        Object.entries(globalStandings[machineId]).forEach(([cid, w]) => {
          if (clientMap.get(cid).homeStudioId === studioId) {
            studioClientWeights[cid] = w;
          }
        });

        const sorted = Object.entries(studioClientWeights).sort(([, a], [, b]) => b - a);
        const weights = sorted.map(([, w]) => w);

        const getPercentileValue = (p: number) => {
          if (weights.length === 0) return 0;
          const index = Math.floor((1 - p/100) * (weights.length - 1));
          return Math.round(weights[index]);
        };

        const thresholds = {
          p90: getPercentileValue(90),
          p75: getPercentileValue(75),
          p50: getPercentileValue(50),
          p25: getPercentileValue(25),
          p10: getPercentileValue(10)
        };

        const studioRankings = sorted.map(([cid, w], i) => ({
          clientId: cid,
          clientName: `${clientMap.get(cid).firstName} ${clientMap.get(cid).lastName}`,
          weight: w,
          rank: i + 1,
          percentile: Math.round(((sorted.length - i) / sorted.length) * 100)
        }));

        const clientPlacements: Record<string, any> = {};
        studioRankings.forEach(r => {
          clientPlacements[r.clientId] = {
            weight: r.weight,
            rank: r.rank,
            percentile: r.percentile
          };
        });

        studioMachineData[machineId] = {
          topPerformers: studioRankings.slice(0, 50),
          stats: {
            count: sorted.length,
            avg: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0,
            max: weights.length ? weights[0] : 0,
            min: weights.length ? weights[weights.length - 1] : 0,
            buckets: calculateBuckets(weights)
          },
          percentileThresholds: thresholds,
          clientPlacements
        };
      }

      await database.collection('leaderboards').doc(`studio_${studioId}`).set({
        lastUpdated,
        scope: studioId,
        machineData: studioMachineData
      });
    }

    console.log(`[LeaderboardCron-${cronId}] Calculation complete and saved.`);
  } catch (err) {
    console.error(`[LeaderboardCron-${cronId}] FAILED:`, err);
    throw err;
  }
}

function calculateBuckets(weights: number[]) {
  if (weights.length === 0) return [];
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min;
  const bucketCount = 10;
  const bucketSize = range / bucketCount || 1;

  const buckets = Array(bucketCount).fill(0);
  weights.forEach(w => {
    const idx = Math.min(Math.floor((w - min) / bucketSize), bucketCount - 1);
    buckets[idx]++;
  });

  return buckets.map((count, i) => ({
    min: Math.floor(min + (i * bucketSize)),
    max: Math.floor(min + ((i + 1) * bucketSize)),
    count
  }));
}

// Allow direct execution
if (process.argv[1] && (process.argv[1].endsWith('leaderboard-cron.ts') || process.argv[1].endsWith('leaderboard-cron.js'))) {
  calculateLeaderboards().catch(err => {
    console.error('Direct Cron execution failed:', err);
    process.exit(1);
  });
}
