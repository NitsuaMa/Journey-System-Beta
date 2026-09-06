import fs from "fs";
import express from "express";
import compression from "compression";
import ical from "node-ical";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

import {
  generateExecutionGuide,
  generateClinicalStrategy,
  generateMachineSetupGuide,
  processLegacyChart,
  extractMachineSettingsFromImage,
} from "./server/gemini.ts";

// Error Handling: Prevent process crash on unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  // After an uncaught exception the process is in an undefined state: keeping
  // it alive leaves a half-broken server that still answers requests. Exit and
  // let the host start a clean one. /healthz lets it notice a wedged process.
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

// Mindbody User Token Cache
// Tokens expire after 60 minutes; we refresh at 55 minutes for safety
const tokenCache: Record<string, { token: string; expiresAt: number }> = {};

async function getMindbodyToken(siteId: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCache[siteId];
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const apiKey = process.env.MINDBODY_API_KEY;
  const sourceName = process.env.MINDBODY_SOURCE_NAME;
  const sourcePassword = process.env.MINDBODY_SOURCE_PASSWORD;

  if (!apiKey || !sourceName || !sourcePassword) {
    throw new Error(
      "MINDBODY_API_KEY, MINDBODY_SOURCE_NAME, and MINDBODY_SOURCE_PASSWORD must be set in .env",
    );
  }

  const response = await fetch(
    "https://api.mindbodyonline.com/public/v6/usertoken/issue",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": apiKey,
        SiteId: String(siteId),
      },
      body: JSON.stringify({
        Username: `_${sourceName}`,
        Password: sourcePassword,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Mindbody Token Error:", response.status, errorText);
    throw new Error(`Failed to issue Mindbody token: ${errorText}`);
  }

  const data = await response.json();
  if (!data.AccessToken) {
    throw new Error("No AccessToken in Mindbody token response");
  }

  // Cache for 55 minutes (tokens expire at 60 min)
  tokenCache[siteId] = {
    token: data.AccessToken,
    expiresAt: now + 55 * 60 * 1000,
  };

  return data.AccessToken;
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  // gzip every response big enough to be worth it. Without this, express.static
  // ships raw bytes: the main JS chunk goes out at ~404 kB instead of ~124 kB.
  // Mounted first so it wraps every route and the static handler below.
  app.use(compression());

  // Only the two Gemini image endpoints send big payloads. Applying their 50mb
  // ceiling to every route meant any POST could allocate 50mb, and Render runs
  // this as a single process (WEB_CONCURRENCY=1) on a small instance: a few
  // concurrent large bodies were enough to exhaust its memory.
  const IMAGE_UPLOAD_PATHS = new Set([
    "/api/gemini/processChart",
    "/api/gemini/extractSettings",
  ]);
  const largeJson = express.json({ limit: "50mb" });
  const standardJson = express.json({ limit: "1mb" });

  app.use((req, res, next) =>
    IMAGE_UPLOAD_PATHS.has(req.path)
      ? largeJson(req, res, next)
      : standardJson(req, res, next),
  );

  // Without this, an over-limit body falls to Express's default handler and
  // comes back as an HTML error page, which the client cannot parse.
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err?.type === "entity.too.large") {
        console.warn("Rejected oversized body on", req.path);
        return res.status(413).json({ error: "Request body too large" });
      }
      return next(err);
    },
  );

  // Health check for the host's monitor. Deliberately does no I/O: it answers
  // "is this process still able to serve requests", nothing more.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.post("/api/gemini/executionGuide", async (req, res) => {
    try {
      const { machineName, referenceText } = req.body;
      const data = await generateExecutionGuide(machineName, referenceText);
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gemini/clinicalStrategy", async (req, res) => {
    try {
      const {
        machineName,
        clientDetails,
        referenceText,
        clientAilments,
        machineContraindications,
      } = req.body;
      const data = await generateClinicalStrategy(
        machineName,
        clientDetails,
        referenceText,
        clientAilments,
        machineContraindications,
      );
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gemini/machineSetup", async (req, res) => {
    try {
      const {
        machineName,
        clientDetails,
        referenceText,
        clientAilments,
        machineContraindications,
      } = req.body;
      const data = await generateMachineSetupGuide(
        machineName,
        clientDetails,
        referenceText,
        clientAilments,
        machineContraindications,
      );
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gemini/processChart", async (req, res) => {
    try {
      const { images, expectedSessions, pageIndex, totalPages } = req.body;
      const data = await processLegacyChart(
        images,
        expectedSessions,
        pageIndex,
        totalPages,
      );
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gemini/extractSettings", async (req, res) => {
    try {
      const { images } = req.body;
      const data = await extractMachineSettingsFromImage(images);
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/log-error", (req, res) => {
    // Always goes to stdout, which is what the hosting platform captures.
    console.log("CLIENT ERROR:", req.body);

    // The file copy is a local-development convenience only. It used to be a
    // bare appendFileSync: one unhandled throw (read-only or full disk) returned
    // a 500, and a client error storm — the Firestore assertion bug produced
    // 3,664 in one session — blocked the single Node thread on every write,
    // which stalls the whole server.
    if (process.env.NODE_ENV !== "production") {
      fs.appendFile(
        "client-errors.log",
        JSON.stringify(req.body) + "\n",
        (err) => {
          if (err) console.warn("Could not write client-errors.log:", err.message);
        },
      );
    }
    res.json({ ok: true });
  });

  // Background Task: Run Master Sync every 60 minutes
  /*
  const SYNC_INTERVAL = 60 * 60 * 1000;
  setInterval(async () => {
    try {
      // await masterSync();
    } catch (error: any) {
      if (error.code === 'resource-exhausted' || error.message?.toLowerCase().includes('quota')) {
        console.error('Scheduled Master Sync failed due to Quota Exceeded. Skipping until reset.');
      } else {
        console.error('Scheduled Master Sync failed:', error);
      }
    }
  }, SYNC_INTERVAL);

  // Initial sync on startup (optional but recommended)
  // masterSync().catch(err => {
    if (err.code === 'resource-exhausted' || err.message?.toLowerCase().includes('quota')) {
      console.error('Initial Master Sync skipped: Quota Limit Exceeded.');
    } else {
      console.error('Initial Master Sync failed:', err);
    }
  });
  */

  app.post("/api/parse-ical", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });
      const response = await axios.get(url);
      const data = ical.parseICS(response.data);
      const events = Object.values(data).filter(
        (ev: any) => ev.type === "VEVENT",
      );
      res.json({ events });
    } catch (e: any) {
      console.error("iCal fetch error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // API Route for Triggering Master Sync Manually
  app.post("/api/trigger-master-sync", async (req, res) => {
    try {
      const { trainerId, hardReset } = req.body;
      // Feature deprecated on server-side. Call handled by frontend.
      res.json({
        success: true,
        message: hardReset
          ? "Master Schedule Hard Reset & Resync triggered successfully"
          : `${trainerId ? "Trainer" : "Master Schedule"} Sync triggered successfully`,
      });
    } catch (error: any) {
      console.error("Manual Sync failed:", error);
      res.status(500).json({ error: error.message || "Sync failed" });
    }
  });

  // Removed diagnostic endpoint that depended on backend sync-logic.ts

  // API Route for Individual Calendar Sync (legacy/on-demand)
  app.post("/api/sync-calendar", async (req, res) => {
    try {
      const { url, trainerId, trainerName } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });

      const response = await axios.get(url);
      const data = ical.parseICS(response.data);

      const events = [];

      // MindBody RegEx patterns for Client Names
      const patterns = [
        /Client:\s*([^(\r\n]+)/i, // Description: Client: John Doe
        /\(([^)]+)\)/, // Summary: Personal Training (John Doe)
        /^([^(:|\n]+)[:|-]/, // Summary: John Doe: Personal Training
        /for\s+([^(\r\n]+)/i, // Summary: Training for John Doe
      ];

      const extractClientName = (summary: string, description: string) => {
        const fullText = `${summary}\n${description}`;

        for (const pattern of patterns) {
          const match = fullText.match(pattern);
          if (match && match[1]) {
            const name = match[1].trim();
            // Basic validation to avoid matching service names
            if (
              name.length > 2 &&
              !name.toLowerCase().includes("training") &&
              !name.toLowerCase().includes("workout")
            ) {
              return name;
            }
          }
        }

        // Fallback: use summary but strip common prefixes
        return summary
          .replace(/Personal Training|Workout|Session/gi, "")
          .trim();
      };

      for (const k in data) {
        if (data.hasOwnProperty(k)) {
          const ev = data[k];
          if (ev.type === "VEVENT") {
            const rawSummary = ev.summary;
            const summary =
              typeof rawSummary === "object" && rawSummary !== null
                ? (rawSummary as any).val
                : rawSummary || "";

            const rawDescription = ev.description;
            const description =
              typeof rawDescription === "object" && rawDescription !== null
                ? (rawDescription as any).val
                : rawDescription || "";

            const clientName = extractClientName(summary, description);

            events.push({
              clientName,
              startTime: ev.start,
              endTime: ev.end,
              trainerName: trainerName || description || "Assigned Staff",
              trainerId: trainerId || null,
              serviceName: summary.includes("(")
                ? summary.split("(")[0].trim()
                : ev.location || "Training Session",
              status: "Scheduled",
              source: "Subscription",
            });
          }
        }
      }

      res.json({ events });
    } catch (error: any) {
      console.error("Sync error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to sync calendar" });
    }
  });

  // Mindbody Sandbox Testing Endpoint — issue user token
  app.post("/api/mindbody/issueUserToken", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res.status(500).json({
          error:
            "MINDBODY_API_KEY environment variable is not set. Please add it to the Secrets in Settings.",
        });
      }

      const { siteId, username, password } = req.body || {};

      if (!siteId || !username || !password) {
        return res.status(400).json({
          error: "siteId, username, and password are required.",
        });
      }

      const requestBody = {
        Username: username,
        Password: password,
      };

      const response = await fetch(
        "https://api.mindbodyonline.com/public/v6/usertoken/issue",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Api-Key": mindbodyApiKey,
            SiteId: String(siteId),
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        console.error("Mindbody API Error:", response.status, errorData);
        let parsedError = errorData;
        try {
          const jsonErr = JSON.parse(errorData);
          if (jsonErr?.Error?.Message) {
            parsedError = jsonErr.Error.Message;
          }
        } catch (_) {}
        return res
          .status(response.status)
          .json({ error: `Mindbody API Error: ${parsedError}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res
        .status(500)
        .json({ error: e.message || "An unexpected error occurred" });
    }
  });

  app.post("/api/mindbody/staff", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res
          .status(500)
          .json({ error: "MINDBODY_API_KEY environment variable is not set." });
      }

      const siteId = req.body?.siteId;

      if (!siteId) {
        return res.status(400).json({ error: "siteId is required" });
      }

      // Get User Token for authenticated access
      let userToken: string | undefined;
      try {
        userToken = await getMindbodyToken(String(siteId));
      } catch (tokenErr: any) {
        console.warn(
          "Could not get Mindbody token for staff, proceeding without:",
          tokenErr.message,
        );
      }

      const staffHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Api-Key": mindbodyApiKey,
        SiteId: String(siteId),
      };
      if (userToken) {
        staffHeaders["Authorization"] = userToken;
      }

      const apiResponse = await fetch(
        `https://api.mindbodyonline.com/public/v6/staff/staff?Limit=200`,
        {
          method: "GET",
          headers: staffHeaders,
        },
      );

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error(
          "Mindbody Fetch Staff Error:",
          apiResponse.status,
          errorText,
        );
        let parsedError = errorText;
        try {
          const jsonErr = JSON.parse(errorText);
          if (jsonErr?.Error?.Message) {
            parsedError = jsonErr.Error.Message;
          }
        } catch (_) {}
        return res
          .status(apiResponse.status)
          .json({ error: `Mindbody API Error: ${parsedError}` });
      }

      const data = await apiResponse.json();
      const staffList = data.StaffMembers || data.Staff || data.staff || [];

      const normalized = staffList.map((s: any) => ({
        id: String(s.Id),
        firstName: s.FirstName || "",
        lastName: s.LastName || "",
        fullName: `${s.FirstName || ""} ${s.LastName || ""}`.trim(),
        email: s.Email || "",
        displayName:
          s.DisplayName || `${s.FirstName || ""} ${s.LastName || ""}`.trim(),
        imageUrl: s.ImageUrl || null,
      }));

      res.json({ staff: normalized });
    } catch (e: any) {
      console.error("Fetch staff error:", e);
      res
        .status(500)
        .json({ error: e.message || "Failed to fetch staff list" });
    }
  });

  /**
   * One staff member's photo, from GET /staff/{staffId}/imageurl.
   *
   * Deliberately NOT how photos normally arrive. /api/mindbody/staff above
   * already returns ImageUrl for the whole roster in a single call, and that
   * is what the trainer pickers use. This endpoint is one round trip per
   * person, so it exists only for a deliberate "refresh this photo" press --
   * the Public API is metered and the bulk call is free.
   */
  app.post("/api/mindbody/staff-image", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res
          .status(500)
          .json({ error: "MINDBODY_API_KEY environment variable is not set." });
      }

      const siteId = req.body?.siteId;
      const staffId = req.body?.staffId;
      if (!siteId) return res.status(400).json({ error: "siteId is required" });
      if (!staffId) return res.status(400).json({ error: "staffId is required" });

      let userToken: string | undefined;
      try {
        userToken = await getMindbodyToken(String(siteId));
      } catch (tokenErr: any) {
        console.warn(
          "Could not get Mindbody token for staff image, proceeding without:",
          tokenErr.message,
        );
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Api-Key": mindbodyApiKey,
        SiteId: String(siteId),
      };
      if (userToken) headers["Authorization"] = userToken;

      const apiResponse = await fetch(
        `https://api.mindbodyonline.com/public/v6/staff/${encodeURIComponent(String(staffId))}/imageurl`,
        { method: "GET", headers },
      );

      // A staff member with no photo is the NORMAL answer here, not an error.
      if (apiResponse.status === 404) {
        return res.json({ imageUrl: null });
      }

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error(
          "Mindbody Staff Image Error:",
          apiResponse.status,
          errorText,
        );
        return res
          .status(apiResponse.status)
          .json({ error: `Mindbody API Error: ${errorText.slice(0, 200)}` });
      }

      const data: any = await apiResponse.json().catch(() => null);
      const raw =
        (typeof data === "string" ? data : undefined) ??
        data?.ImageUrl ??
        data?.imageUrl ??
        data?.Staff?.ImageUrl ??
        null;

      // Only https survives. Anything else would be stored and then render as
      // a broken avatar until somebody noticed.
      const imageUrl =
        typeof raw === "string" && /^https:\/\/\S+$/i.test(raw.trim())
          ? raw.trim()
          : null;

      res.json({ imageUrl });
    } catch (e: any) {
      console.error("Fetch staff image error:", e);
      res.status(500).json({ error: e.message || "Failed to fetch staff image" });
    }
  });

  app.post("/api/mindbody/locations", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res
          .status(500)
          .json({ error: "MINDBODY_API_KEY environment variable is not set." });
      }

      const siteId = req.body?.siteId;
      if (!siteId) {
        return res.status(400).json({ error: "siteId is required" });
      }

      let userToken: string | undefined;
      try {
        userToken = await getMindbodyToken(String(siteId));
      } catch (tokenErr: any) {
        console.warn(
          "Could not get Mindbody token for locations, proceeding without token:",
          tokenErr.message,
        );
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Api-Key": mindbodyApiKey,
        SiteId: String(siteId),
      };
      if (userToken) {
        headers["Authorization"] = userToken;
      }

      const apiResponse = await fetch(
        "https://api.mindbodyonline.com/public/v6/site/locations",
        {
          method: "GET",
          headers,
        },
      );

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        const locationsList = data.Locations || data.locations || [];
        const normalized = locationsList.map((loc: any) => ({
          id: String(loc.Id),
          name: loc.Name || `Location ${loc.Id}`,
          address: loc.Address || "",
          city: loc.City || "",
          state: loc.State || "",
        }));
        return res.json({ locations: normalized });
      }

      const siteLocationsStatus = apiResponse.status;
      const siteLocationsError = await apiResponse.text().catch(() => "");
      console.warn(
        `Mindbody /site/locations returned status ${siteLocationsStatus} (${siteLocationsError}), falling back to appointments scan...`,
      );

      // Fallback strategy: Query recent staff appointments to extract active LocationId and Location names
      if (userToken) {
        try {
          const now = new Date();
          const start = now.toISOString().split("T")[0];
          const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0];

          const apptParams = new URLSearchParams({
            StartDate: `${start}T00:00:00`,
            EndDate: `${end}T23:59:59`,
            Limit: "100",
          });

          const apptResponse = await fetch(
            `https://api.mindbodyonline.com/public/v6/appointment/staffappointments?${apptParams.toString()}`,
            {
              method: "GET",
              headers,
            },
          );

          if (apptResponse.ok) {
            const apptData = await apptResponse.json();
            const appts = apptData.Appointments || apptData.appointments || [];
            const locMap = new Map<string, string>();

            appts.forEach((a: any) => {
              if (a.LocationId !== undefined && a.LocationId !== null) {
                const locId = String(a.LocationId);
                const locName = a.LocationName || a.Location?.Name || `Location ${locId}`;
                if (!locMap.has(locId)) {
                  locMap.set(locId, locName);
                }
              }
            });

            if (locMap.size > 0) {
              const fallbackLocs = Array.from(locMap.entries()).map(([id, name]) => ({
                id,
                name,
              }));
              return res.json({ locations: fallbackLocs });
            }
          } else {
            const apptErrText = await apptResponse.text().catch(() => "");
            console.warn(`Fallback staffappointments also failed with status ${apptResponse.status}: ${apptErrText}`);
          }
        } catch (fbErr: any) {
          console.warn("Fallback scan error:", fbErr.message);
        }
      }

      // Surface Mindbody's own message rather than the raw JSON envelope so the
      // client has something short enough to show in the form.
      let parsedMessage = siteLocationsError;
      let mindbodyCode: string | undefined;
      try {
        const jsonErr = JSON.parse(siteLocationsError);
        if (jsonErr?.Error?.Message) parsedMessage = jsonErr.Error.Message;
        if (jsonErr?.Error?.Code) mindbodyCode = String(jsonErr.Error.Code);
      } catch (_) {}

      return res.status(siteLocationsStatus).json({
        error: parsedMessage || "Endpoint not found/authorized",
        code: mindbodyCode,
      });
    } catch (e: any) {
      console.error("Fetch locations error:", e);
      res
        .status(500)
        .json({ error: e.message || "Failed to fetch location list" });
    }
  });

  app.post("/api/mindbody/staff-appointments", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res
          .status(500)
          .json({ error: "MINDBODY_API_KEY environment variable is not set." });
      }

      const { siteId, startDate, endDate, staffIds } = req.body || {};

      if (!siteId) {
        return res.status(400).json({ error: "siteId is required" });
      }

      const now = new Date();
      const start = startDate || now.toISOString().split("T")[0];
      const end =
        endDate ||
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

      const userToken = await getMindbodyToken(String(siteId));

      let allAppointments: any[] = [];
      let offset = 0;
      const limit = 500;
      let hasMore = true;

      // Safety valve only -- `hasMore` (driven by Mindbody's own
      // PaginationResponse.TotalResults) is the real stopping condition.
      // This site alone runs ~3,800+ appointments per 30-day window across
      // its shared studios, so the old cap of 2000 silently truncated the
      // result before every studio's appointments were even fetched --
      // whichever studio's data Mindbody happened to return last in the
      // page order got cut off entirely, with no error to show for it.
      while (hasMore && offset < 100000) {
        const params = new URLSearchParams({
          StartDate: `${start}T00:00:00`,
          EndDate: `${end}T23:59:59`,
          Limit: String(limit),
          Offset: String(offset),
        });

        if (staffIds && Array.isArray(staffIds) && staffIds.length > 0) {
          staffIds.forEach((id: string | number) =>
            params.append("StaffIds", String(id)),
          );
        }

        const apiResponse = await fetch(
          `https://api.mindbodyonline.com/public/v6/appointment/staffappointments?${params.toString()}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Api-Key": mindbodyApiKey,
              SiteId: String(siteId),
              Authorization: userToken,
            },
          },
        );

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          console.error(
            "Mindbody Staff Appointments Error:",
            apiResponse.status,
            errorText,
          );
          if (offset === 0) {
            return res
              .status(apiResponse.status)
              .json({ error: `Mindbody API Error: ${errorText}` });
          }
          break;
        }

        const data = await apiResponse.json();
        const pageAppts = data.Appointments || data.appointments || [];
        allAppointments.push(...pageAppts);

        const totalResults = data.PaginationResponse?.TotalResults || 0;
        offset += limit;
        hasMore =
          pageAppts.length === limit && allAppointments.length < totalResults;
      }

      const appointments = allAppointments;

      const uniqueClientIds = [
        ...new Set(
          appointments
            .map((a: any) => a.Client?.Id || a.ClientId)
            .filter((id: any) => id != null)
            .map((id: any) => String(id)),
        ),
      ];

      const clientNameMap: Record<
        string,
        {
          firstName: string;
          lastName: string;
          email: string;
          phone: string;
          dateOfBirth: string;
          gender: string;
          address: string;
          photoUrl: string;
          emergencyContactName: string;
          emergencyContactPhone: string;
        }
      > = {};

      const BATCH_SIZE = 20;
      const batchPromises = [];

      for (let i = 0; i < uniqueClientIds.length; i += BATCH_SIZE) {
        const batch = uniqueClientIds.slice(i, i + BATCH_SIZE);
        const clientParams = new URLSearchParams();
        batch.forEach((id: string) => clientParams.append("ClientIds", id));
        const clientUrl = `https://api.mindbodyonline.com/public/v6/client/clients?${clientParams.toString()}`;

        batchPromises.push(
          fetch(clientUrl, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Api-Key": mindbodyApiKey,
              SiteId: String(siteId),
              Authorization: userToken,
            },
          })
            .then(async (res) => {
              if (res.ok) {
                const clientData = await res.json();
                return clientData.Clients || [];
              }
              return [];
            })
            .catch(() => []),
        );
      }

      const clientResults = await Promise.all(batchPromises);
      clientResults.flat().forEach((c: any) => {
        if (c && c.Id != null) {
          const cId = String(c.Id);
          clientNameMap[cId] = {
            firstName: c.FirstName || "",
            lastName: c.LastName || "",
            email: c.Email || "",
            phone: c.MobilePhone || c.HomePhone || c.WorkPhone || "",
            dateOfBirth: c.BirthDate ? c.BirthDate.split("T")[0] : "",
            gender: c.Gender || "",
            address: c.AddressLine1 || "",
            photoUrl: c.PhotoUrl || "",
            emergencyContactName: c.EmergencyContactInfoName || "",
            emergencyContactPhone: c.EmergencyContactInfoPhone || "",
          };
        }
      });

      const normalized = appointments.map((appt: any) => {
        const clientId = String(appt.Client?.Id || appt.ClientId || "");
        const clientInfo = clientNameMap[clientId];

        return {
          Id: appt.Id,
          StaffId: appt.Staff?.Id || appt.StaffId,
          StaffFirstName: appt.Staff?.FirstName || appt.StaffFirstName || "",
          StaffLastName: appt.Staff?.LastName || appt.StaffLastName || "",
          ClientId: clientId || null,
          ClientFirstName:
            appt.Client?.FirstName || clientInfo?.firstName || "",
          ClientLastName: appt.Client?.LastName || clientInfo?.lastName || "",
          ClientEmail: appt.Client?.Email || clientInfo?.email || "",
          ClientPhone: appt.Client?.MobilePhone || appt.Client?.HomePhone || clientInfo?.phone || "",
          ClientDOB: clientInfo?.dateOfBirth || "",
          ClientGender: clientInfo?.gender || "",
          ClientAddress: clientInfo?.address || "",
          ClientPhotoUrl: appt.Client?.PhotoUrl || clientInfo?.photoUrl || "",
          ClientEmergencyName: clientInfo?.emergencyContactName || "",
          ClientEmergencyPhone: clientInfo?.emergencyContactPhone || "",
          StartDateTime: appt.StartDateTime,
          EndDateTime: appt.EndDateTime,
          Status: appt.Status,
          SessionTypeName:
            appt.SessionType?.Name ||
            appt.SessionTypeName ||
            "Training Session",
          LocationId: appt.Location?.Id || appt.LocationId || null,

          // Pass / waitlist / visit-count passthrough. This normalizer is a
          // whitelist — anything not listed here is dropped before the app ever
          // sees it, which is why these have to be named explicitly.
          //
          // Mindbody's published appointment schema does not document these
          // (they appear on CLASS bookings), so they may simply be absent. Read
          // from several shapes and pass null through; the client-side
          // extractor ignores nulls, so an absent field writes nothing.
          ClientPassId:
            appt.ClientPassId ?? appt.ClientPass?.Id ?? null,
          ClientPassSessionsTotal:
            appt.ClientPassSessionsTotal ?? appt.ClientPass?.SessionsTotal ?? null,
          ClientPassSessionsDeducted:
            appt.ClientPassSessionsDeducted ??
            appt.ClientPass?.SessionsDeducted ??
            null,
          ClientPassSessionsRemaining:
            appt.ClientPassSessionsRemaining ??
            appt.ClientPass?.SessionsRemaining ??
            null,
          ClientPassActivationDateTime:
            appt.ClientPassActivationDateTime ??
            appt.ClientPass?.ActivationDateTime ??
            null,
          ClientPassExpirationDateTime:
            appt.ClientPassExpirationDateTime ??
            appt.ClientPass?.ExpirationDateTime ??
            null,
          BookingOriginatedFromWaitlist:
            appt.BookingOriginatedFromWaitlist ?? null,
          ClientsNumberOfVisitsAtSite:
            appt.ClientsNumberOfVisitsAtSite ??
            appt.Client?.NumberOfVisitsAtSite ??
            null,
        };
      });

      res.json({ appointments: normalized, total: normalized.length });
    } catch (e: any) {
      console.error("Staff appointments error:", e);
      res
        .status(500)
        .json({ error: e.message || "Failed to fetch staff appointments" });
    }
  });

  app.post("/api/mindbody/client-demographics", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res
          .status(500)
          .json({ error: "MINDBODY_API_KEY environment variable is not set." });
      }

      const { siteId, mindbodyClientId, clientName } = req.body || {};

      if (!siteId) {
        return res.status(400).json({ error: "siteId is required" });
      }

      // Only the caller's own site. Retrying against the sandbox (-99) used to
      // return demo records that were then written onto real client profiles.
      const sitesToTry = [String(siteId)];

      let mbClients: any[] = [];
      let lastApiError = "";

      for (const currentSiteId of sitesToTry) {
        if (mbClients.length > 0) break;
        try {
          const userToken = await getMindbodyToken(currentSiteId);

          // 1. Try by Client ID
          if (mindbodyClientId) {
            const url = `https://api.mindbodyonline.com/public/v6/client/clients?ClientIds=${encodeURIComponent(String(mindbodyClientId))}`;
            const res1 = await fetch(url, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "Api-Key": mindbodyApiKey,
                SiteId: currentSiteId,
                Authorization: userToken,
              },
            });
            if (res1.ok) {
              const data1 = await res1.json();
              mbClients = data1.Clients || [];
            } else {
              lastApiError = await res1.text();
              console.warn(`Mindbody ClientIds lookup failed (Site ${currentSiteId}):`, res1.status, lastApiError);
            }
          }

          // 2. Fallback to SearchText
          if (mbClients.length === 0 && clientName) {
            const url = `https://api.mindbodyonline.com/public/v6/client/clients?SearchText=${encodeURIComponent(String(clientName))}`;
            const res2 = await fetch(url, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "Api-Key": mindbodyApiKey,
                SiteId: currentSiteId,
                Authorization: userToken,
              },
            });
            if (res2.ok) {
              const data2 = await res2.json();
              mbClients = data2.Clients || [];
            } else {
              lastApiError = await res2.text();
              console.warn(`Mindbody SearchText lookup failed (Site ${currentSiteId}):`, res2.status, lastApiError);
            }
          }
        } catch (err: any) {
          console.warn(`Mindbody search error for Site ID ${currentSiteId}:`, err);
          lastApiError = err.message || String(err);
        }
      }

      if (mbClients.length === 0) {
        return res
          .status(404)
          .json({ error: lastApiError ? `MindBody API Response: ${lastApiError}` : `Client "${mindbodyClientId || clientName}" not found in MindBody Site ID ${siteId}` });
      }

      const client = mbClients[0];
      return res.json({
        mindbodyClientId: String(client.Id),
        firstName: client.FirstName,
        lastName: client.LastName,
        email: client.Email || "",
        phone: client.MobilePhone || client.HomePhone || "",
        dateOfBirth: client.BirthDate ? client.BirthDate.split("T")[0] : "",
        gender: client.Gender || "",
        address: client.AddressLine1 || "",
        photoUrl: client.PhotoUrl || "",
        emergencyContactName: client.EmergencyContactInfoName || "",
        emergencyContactPhone: client.EmergencyContactInfoPhone || "",
        // Mindbody's account notes. Kept separate from the app's trainer-authored
        // `notes` field -- the caller writes this to `mindbodyNotes`.
        notes: typeof client.Notes === "string" ? client.Notes : "",
      });
    } catch (error: any) {
      console.error("Error fetching MindBody client demographics:", error);
      return res.status(500).json({ error: error.message || "Server error" });
    }
  });

  /**
   * Pulls a client's contracts and active memberships from Mindbody.
   *
   * The `clientContract.*` / `clientMembershipAssignment.*` webhooks only fire
   * on future changes and only reach the live project, so this is how existing
   * clients (and any non-live environment) get populated. The response is
   * shaped to match the webhook's Firestore records so both writers agree.
   */
  app.post("/api/mindbody/client-commercial", async (req, res) => {
    try {
      const mindbodyApiKey = process.env.MINDBODY_API_KEY;
      if (!mindbodyApiKey) {
        return res
          .status(500)
          .json({ error: "MINDBODY_API_KEY environment variable is not set." });
      }

      const { siteId, mindbodyClientId } = req.body || {};
      if (!siteId) return res.status(400).json({ error: "siteId is required" });
      if (!mindbodyClientId) {
        return res.status(400).json({ error: "mindbodyClientId is required" });
      }

      const site = String(siteId).trim();
      const clientId = String(mindbodyClientId).trim();
      const userToken = await getMindbodyToken(site);

      const mbHeaders = {
        "Content-Type": "application/json",
        "Api-Key": mindbodyApiKey,
        SiteId: site,
        Authorization: userToken,
      };

      const callMindbody = async (path: string) => {
        const url = `https://api.mindbodyonline.com/public/v6/client/${path}?ClientId=${encodeURIComponent(clientId)}&Limit=100`;
        const r = await fetch(url, { method: "GET", headers: mbHeaders });
        if (!r.ok) {
          const text = await r.text();
          console.warn(`Mindbody ${path} failed (Site ${site}):`, r.status, text);
          return { ok: false as const, error: text, data: null as any };
        }
        return { ok: true as const, error: "", data: await r.json() };
      };

      // Fetched independently: a client can hold contracts but no membership,
      // and one endpoint failing should not blank the other.
      const [contractsRes, membershipsRes] = await Promise.all([
        callMindbody("clientcontracts"),
        callMindbody("activeclientmemberships"),
      ]);

      if (!contractsRes.ok && !membershipsRes.ok) {
        return res.status(502).json({
          error: `MindBody API Response: ${contractsRes.error || membershipsRes.error}`,
        });
      }

      const contracts = (contractsRes.data?.Contracts || []).map((c: any) => ({
        // Mindbody's ClientContract `Id` IS the clientContractId the webhook
        // keys on, so pull-synced and webhook-synced records land on the
        // same map entry instead of duplicating.
        clientContractId: c.Id,
        contractName: c.ContractName || "",
        agreementDate: c.AgreementDate || null,
        startDate: c.StartDate || null,
        endDate: c.EndDate || null,
        // The pull API exposes AutopayStatus, not the webhook's boolean
        // isAutoRenewing, so it is reported under its own name and never
        // overwrites a value a webhook already supplied.
        autopayStatus: c.AutopayStatus || "",
        originationLocationId: c.OriginationLocationId ?? null,
        siteId: c.SiteId ?? Number(site),
      }));

      const memberships = (membershipsRes.data?.ClientMemberships || []).map(
        (m: any) => ({
          membershipId: m.Id,
          membershipName: m.Name || "",
          activeDate: m.ActiveDate || null,
          expirationDate: m.ExpirationDate || null,
          count: m.Count ?? null,
          remaining: m.Remaining ?? null,
          programName: m.Program?.Name || "",
          siteId: m.SiteId ?? Number(site),
        }),
      );

      return res.json({
        contracts,
        memberships,
        partial: !contractsRes.ok || !membershipsRes.ok,
      });
    } catch (error: any) {
      console.error("Error fetching MindBody client commercial data:", error);
      return res.status(500).json({ error: error.message || "Server error" });
    }
  });

  app.post("/api/mindbody/test-webhook", async (req, res) => {
    try {
      const webhookSecret = process.env.MINDBODY_WEBHOOK_SECRET;
      const configPath = path.resolve(
        process.cwd(),
        "firebase-applet-config.json",
      );
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const projectId = config.projectId;
      const webhookUrl =
        req.body?.webhookUrl ||
        `https://us-central1-${projectId}.cloudfunctions.net/mindbodyWebhook`;

      const testPayload = JSON.stringify({
        messageId: `test-${Date.now()}`,
        eventId: "clientUpdated",
        eventName: "clientUpdated",
        eventData: {
          clientId: "test-client-001",
          firstName: "Test",
          lastName: "Client",
          membershipStatus: "Active",
          siteId: req.body?.siteId,
        },
      });

      let signatureHeader = "test-signature";
      if (webhookSecret) {
        const crypto = await import("crypto");
        let key: string | Buffer = webhookSecret;
        if (webhookSecret.length === 44 && webhookSecret.endsWith("=")) {
          try {
            key = Buffer.from(webhookSecret, "base64");
          } catch {
            key = webhookSecret;
          }
        }
        const hmac = crypto.createHmac("sha256", key);
        hmac.update(testPayload);
        signatureHeader = hmac.digest("base64");
      }

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mindbody-signature": signatureHeader,
        },
        body: testPayload,
      });
      const responseText = await webhookResponse.text();

      res.json({
        success: webhookResponse.ok,
        statusCode: webhookResponse.status,
        response: responseText,
        webhookUrl,
      });
    } catch (e: any) {
      console.error("Test webhook error:", e);
      res.status(500).json({ error: e.message || "Webhook test failed" });
    }
  });

  // Any /api path that reached this point matched no route above. Answer with
  // JSON, not the SPA shell: the catch-all further down would hand back
  // index.html, so a typo'd endpoint looks like a successful HTML response to
  // fetch() and fails later with a confusing JSON parse error.
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not found", path: req.originalUrl });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    // Imported here rather than at the top of the file so production never
    // pulls Vite (and its Rollup/esbuild dependency graph) into memory at boot.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Vite stamps a content hash into every asset filename
    // (index-BycyQ8Hk.js), so the bytes behind a given URL can never change.
    // That makes them safe to cache for a year, which removes ~20 revalidation
    // round-trips from every page load.
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        maxAge: "1y",
        immutable: true,
      }),
    );

    // Anything else in dist has no hash in its name, so keep it short-lived.
    // index: false leaves "/" to the catch-all below.
    app.use(express.static(distPath, { index: false, maxAge: "1h" }));

    // A missing chunk must 404. Falling through to index.html returns
    // "200 OK" with HTML in it, and the browser then tries to parse that HTML
    // as JavaScript: "Uncaught SyntaxError: Unexpected token '<'".
    app.use("/assets", (req, res) => {
      res.status(404).type("text/plain").send("Not found");
    });

    // index.html is the file that names the hashed assets above. A cached copy
    // pins the browser to a previous deploy's filenames, so it must always be
    // revalidated.
    app.get("*", (req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
