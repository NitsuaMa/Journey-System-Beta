/**
 * LEGACY DATA INGESTION — the FileMaker CSV importer.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Moved out of the trainer's App Settings (B4). This walks a legacy FileMaker
 * export and creates clients, sessions and exercise logs from it — a schema
 * migration wearing a file picker. The client data schema migration is still
 * pending, so putting it one tap from a trainer's settings screen meant a
 * mis-tap could write thousands of documents into production. It is admin
 * work, and now it lives where admin work lives.
 *
 * The import body is unchanged: it was working, and retyping 220 lines of
 * row-mapping and cache-keyed lookups to relocate it would buy nothing but
 * transcription bugs.
 */

import type React from "react";
import { useState } from "react";
import Papa from "papaparse";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { Client, Machine, Trainer } from "../../types";
import { parseMachineSettings } from "../../lib/utils";

export interface LegacyImportDeps {
  machines: Machine[];
  activeStudioId: string | null;
  authTrainer: Trainer | null;
}

export function useLegacyImport(deps: LegacyImportDeps) {
  const { machines, activeStudioId, authTrainer } = deps;

  const [isLegacyImporting, setIsLegacyImporting] = useState(false);
  const [legacyStats, setLegacyStats] = useState<{
    clients: number;
    sessions: number;
    logs: number;
    failed: number;
  } | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);

  const handleLegacyFileUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLegacyImporting(true);
    setLegacyError(null);
    setLegacyStats(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          let clientCount = 0;
          let sessionCount = 0;
          let logCount = 0;
          let failedCount = 0;

          const clientCache: Record<string, string> = {};
          const machineCache: Record<string, string> = {};

          const machinesSnap = await getDocs(collection(db, "machines"));
          machinesSnap.forEach((doc) => {
            const m = doc.data() as Machine;
            machineCache[m.name.toLowerCase()] = doc.id;
            if (m.fullName) machineCache[m.fullName.toLowerCase()] = doc.id;
          });

          const clientsSnap = await getDocs(collection(db, "clients"));
          clientsSnap.forEach((doc) => {
            const c = doc.data() as Client;
            clientCache[`${c.firstName} ${c.lastName}`.toLowerCase()] = doc.id;
          });

          let batch = writeBatch(db);
          let opCount = 0;
          const localSessionCache: Record<string, string> = {};

          for (const row of data) {
            const firstName = row["First Name"] || row["FirstName"] || "";
            const lastName = row["Last Name"] || row["LastName"] || "";
            const fullName =
              row["Client Name"] ||
              row["Client"] ||
              row["Full Name"] ||
              `${firstName} ${lastName}`.trim();

            const machineName =
              row["Machine"] || row["Exercise"] || row["Equipment"] || "";
            const weight = row["Weight"] || row["Resistance"] || "";
            const reps = row["Reps"] || row["Repetitions"] || "";
            const dateStr =
              row["Date"] || row["Timestamp"] || row["Workout Date"] || "";
            const trainerInitials = (
              row["Trainer"] ||
              row["Staff"] ||
              row["Initials"] ||
              "FM"
            ).toUpperCase();
            const notes = row["Notes"] || row["Comments"] || "";
            const settingsStr =
              row["Settings"] || row["Machine Settings"] || "";

            if (!fullName || !machineName || !dateStr) {
              failedCount++;
              continue;
            }

            let clientId = clientCache[fullName.toLowerCase()];
            if (!clientId) {
              const nameParts = fullName.split(" ");
              const fName = nameParts[0] || "Imported";
              const lName = nameParts.slice(1).join(" ") || "Client";

              const clientRef = doc(collection(db, "clients"));
              clientId = clientRef.id;

              batch.set(clientRef, {
                firstName: fName,
                lastName: lName,
                gender: "Other",
                height: row["Height"] || "N/A",
                isActive: true,
                remainingSessions: 0,
                consultationCompleted: true,
                globalNotes: row["Client Notes"] || "",
                createdAt: serverTimestamp(),
              });
              clientCache[fullName.toLowerCase()] = clientId;
              clientCount++;
              opCount++;
            }

            const machineId = machineCache[machineName.toLowerCase()];
            if (!machineId) {
              failedCount++;
              continue;
            }

            const sessionDate = new Date(dateStr);
            if (isNaN(sessionDate.getTime())) {
              failedCount++;
              continue;
            }

            // High Performance Cache for Session Retrieval within loop
            let sessionId: string;
            const sessionCacheKey = `${clientId}_${sessionDate.toISOString().split("T")[0]}`;

            if (localSessionCache[sessionCacheKey]) {
              sessionId = localSessionCache[sessionCacheKey];
            } else {
              const q = query(
                collection(db, "sessions"),
                where("clientId", "==", clientId),
                where("date", "==", sessionDate.toISOString().split("T")[0]),
              );
              const existingSessions = await getDocs(q);

              if (existingSessions.empty) {
                const sessionRef = doc(collection(db, "sessions"));
                batch.set(sessionRef, {
                  clientId,
                  sessionType: "Standard",
                  sessionNumber: 0,
                  date: sessionDate.toISOString().split("T")[0],
                  trainerInitials,
                  status: "Completed",
                  notes: row["Session Notes"] || "",
                  createdAt: Timestamp.fromDate(sessionDate),
                });
                sessionId = sessionRef.id;
                sessionCount++;
                opCount++;
              } else {
                sessionId = existingSessions.docs[0].id;
              }
              localSessionCache[sessionCacheKey] = sessionId;
            }

            const logRef = doc(collection(db, "exerciseLogs"));
            batch.set(logRef, {
              sessionId,
              clientId,
              machineId,
              weight,
              reps,
              notes,
              machineSettings: settingsStr
                ? parseMachineSettings(settingsStr)
                : {},
              createdAt: Timestamp.fromDate(sessionDate),
              studioId:
                activeStudioId ||
                authTrainer?.primaryHomeStudioId ||
                "unassigned",
            });
            logCount++;
            opCount++;

            if (settingsStr) {
              const settings = parseMachineSettings(settingsStr);
              const settingsRef = doc(
                db,
                "clientMachineSettings",
                `${clientId}_${machineId}`,
              );

              batch.set(
                settingsRef,
                {
                  clientId,
                  machineId,
                  settings,
                  updatedBy: trainerInitials,
                  updatedAt: Timestamp.fromDate(sessionDate),
                  studioId:
                    activeStudioId ||
                    authTrainer?.primaryHomeStudioId ||
                    "unassigned",
                },
                { merge: true },
              );
              opCount++;
            }

            if (opCount >= 400) {
              await batch.commit();
              batch = writeBatch(db);
              opCount = 0;
            }
          }

          if (opCount > 0) {
            await batch.commit();
          }

          setLegacyStats({
            clients: clientCount,
            sessions: sessionCount,
            logs: logCount,
            failed: failedCount,
          });
        } catch (err: any) {
          console.error("Legacy import error:", err);
          setLegacyError(err.message || "Failed to import legacy data");
        } finally {
          setIsLegacyImporting(false);
          event.target.value = "";
        }
      },
      error: (err) => {
        setLegacyError(err.message);
        setIsLegacyImporting(false);
        event.target.value = "";
      },
    });
  };
  return {
    isLegacyImporting,
    legacyStats,
    legacyError,
    handleLegacyFileUpload,
  };
}
