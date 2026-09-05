/**
 * STUDIO DATA EXPORTS — payroll, attendance and client progress CSVs.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Lifted verbatim out of TrainerControlHubView, where these three exports sat
 * behind a trainer-visible "Data & Reports" tab. They are admin work now (D):
 * a payroll CSV lists every trainer's session count and a progress CSV carries
 * client data across the whole studio, neither of which belongs to whoever
 * happens to be on the floor.
 *
 * MOVED AS A HOOK, NOT REWRITTEN
 * ------------------------------
 * The export bodies are unchanged. They were working, they are the kind of
 * code that is tedious rather than clever, and retyping 280 lines of CSV
 * column mapping to relocate it would only introduce transcription bugs in
 * exchange for nothing. What changed is the wrapper: the state and the toasts
 * that used to live in a 2,963-line component now live here, so the admin tab
 * is a layout and this file is the behaviour.
 */

import { useState } from "react";
import Papa from "papaparse";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useToast } from "../../contexts/ToastContext";
import {
  Client,
  ScheduleEntry,
  Studio,
  Trainer,
  WorkoutSession,
} from "../../types";

export interface StudioExportDeps {
  trainers: Trainer[];
  clients: Client[];
  studios: Studio[];
  activeStudioId: string | null;
}

export function useStudioExports(deps: StudioExportDeps) {
  const { trainers, clients, studios, activeStudioId } = deps;
  const { success: toastSuccess, error: toastError } = useToast();

  const [exportStartDate, setExportStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [exportEndDate, setExportEndDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );

  const [isExportingPayroll, setIsExportingPayroll] = useState(false);
  const [isExportingAttendance, setIsExportingAttendance] = useState(false);
  const [isExportingProgress, setIsExportingProgress] = useState(false);

  const fetchSessionsForExport = async (
    startDateStr: string,
    endDateStr: string,
  ) => {
    try {
      const start = new Date(startDateStr);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDateStr);
      end.setHours(23, 59, 59, 999);

      let q = query(
        collection(db, "sessions"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<=", Timestamp.fromDate(end)),
      );

      const snap = await getDocs(q);
      let data = snap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as WorkoutSession,
      );

      // Filter by status === 'Completed'
      data = data.filter((s) => s.status === "Completed");

      // Filter by activeStudioId if selected
      if (activeStudioId) {
        data = data.filter((s) => s.hostedAtStudioId === activeStudioId);
      }

      return data;
    } catch (err: any) {
      console.error(err);
      toastError("Failed to fetch sessions: " + err.message);
      return [];
    }
  };

  const fetchSchedulesForExport = async (
    startDateStr: string,
    endDateStr: string,
  ) => {
    try {
      const start = new Date(startDateStr);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDateStr);
      end.setHours(23, 59, 59, 999);

      let q = query(
        collection(db, "schedules"),
        where("startTime", ">=", Timestamp.fromDate(start)),
        where("startTime", "<=", Timestamp.fromDate(end)),
      );

      const snap = await getDocs(q);
      let data = snap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as ScheduleEntry,
      );

      // Filter by activeStudioId if not 'all'
      if (activeStudioId) {
        data = data.filter((s) => s.studioId === activeStudioId);
      }

      return data;
    } catch (err: any) {
      console.error(err);
      toastError("Failed to fetch schedule data: " + err.message);
      return [];
    }
  };

  const handleExportPayroll = async () => {
    setIsExportingPayroll(true);
    try {
      const allSessions = await fetchSessionsForExport(
        exportStartDate,
        exportEndDate,
      );
      if (allSessions.length === 0) {
        toastError("No completed sessions found in the selected date range.");
        return;
      }

      const payrollData = allSessions.map((s) => {
        const trainerObj = trainers.find(
          (t) => t.id === s.trainerId || t.initials === s.trainerInitials,
        );
        const clientObj = clients.find((c) => c.id === s.clientId);
        const studioObj = studios.find((std) => std.id === s.hostedAtStudioId);

        const dateObj = s.createdAt?.toDate?.() || new Date(s.createdAt);

        return {
          "Trainer Initials": s.trainerInitials || "N/A",
          "Trainer Name": trainerObj?.fullName || "Unknown Trainer",
          "Studio ID": s.hostedAtStudioId || "N/A",
          "Studio Name": studioObj?.name || "Unknown Studio",
          "Client Name": clientObj
            ? `${clientObj.firstName} ${clientObj.lastName}`
            : "Unknown Client",
          "Session Date": dateObj.toISOString().split("T")[0],
          "Session Type": s.sessionType || "Standard",
          "Session Notes": s.notes || "",
        };
      });

      const filename = `payroll_details_${exportStartDate}_to_${exportEndDate}.csv`;
      const csv = Papa.unparse(payrollData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toastSuccess(`Payroll CSV (${filename}) downloaded successfully.`);
    } catch (err: any) {
      console.error(err);
      toastError("Failed to export payroll summary: " + err.message);
    } finally {
      setIsExportingPayroll(false);
    }
  };

  const handleExportAttendance = async () => {
    setIsExportingAttendance(true);
    try {
      const schedules = await fetchSchedulesForExport(
        exportStartDate,
        exportEndDate,
      );
      if (schedules.length === 0) {
        toastError("No attendance logs found in the selected date range.");
        return;
      }

      const attendanceData = schedules.map((s) => {
        const dateObj = s.startTime?.toDate?.() || new Date(s.startTime);
        return {
          Date: dateObj.toISOString().split("T")[0],
          "Start Time": dateObj.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          "Client ID": s.clientId || "Unassigned",
          "Client Name": s.clientName || "Unknown Client",
          "Trainer ID": s.trainerId || "Unassigned",
          "Trainer Name": s.trainerName || "Unknown Trainer",
          Status: s.status || "Scheduled",
          Service: s.serviceName || "Workout",
          Source: s.source || "Manual",
          "Studio ID": s.studioId || "",
        };
      });

      const filename = `client_attendance_${exportStartDate}_to_${exportEndDate}.csv`;
      const csv = Papa.unparse(attendanceData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toastSuccess(`Attendance CSV (${filename}) downloaded successfully.`);
    } catch (err: any) {
      console.error(err);
      toastError("Failed to export attendance summary: " + err.message);
    } finally {
      setIsExportingAttendance(false);
    }
  };

  const handleExportProgress = async () => {
    setIsExportingProgress(true);
    try {
      const allSessions = await fetchSessionsForExport(
        exportStartDate,
        exportEndDate,
      );
      if (allSessions.length === 0) {
        toastError("No completed sessions found in the selected date range.");
        return;
      }

      const start = new Date(exportStartDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(exportEndDate);
      end.setHours(23, 59, 59, 999);

      const logsSnap = await getDocs(
        query(
          collection(db, "exerciseLogs"),
          where("createdAt", ">=", Timestamp.fromDate(start)),
          where("createdAt", "<=", Timestamp.fromDate(end)),
        ),
      );

      const logsBySession: Record<string, any[]> = {};
      logsSnap.forEach((doc) => {
        const data = doc.data();
        if (data.sessionId) {
          if (!logsBySession[data.sessionId])
            logsBySession[data.sessionId] = [];
          logsBySession[data.sessionId].push(data);
        }
      });

      const groupedByClient: Record<
        string,
        { sessions: WorkoutSession[]; weights: number[] }
      > = {};
      allSessions.forEach((s) => {
        if (!s.clientId) return;
        if (!groupedByClient[s.clientId]) {
          groupedByClient[s.clientId] = { sessions: [], weights: [] };
        }
        groupedByClient[s.clientId].sessions.push(s);

        const sLogs = logsBySession[s.id || ""] || [];
        sLogs.forEach((log) => {
          const w = parseFloat(log.weight);
          if (!isNaN(w) && w > 0) {
            groupedByClient[s.clientId!].weights.push(w);
          }
        });
      });

      const progressData = Object.entries(groupedByClient).map(
        ([cId, data]) => {
          const clientObj = clients.find((c) => c.id === cId);
          const name = clientObj
            ? `${clientObj.firstName} ${clientObj.lastName}`
            : "Unknown Client";
          const studioObj = studios.find(
            (std) => std.id === clientObj?.homeStudioId,
          );

          const sessionsCount = data.sessions.length;
          const totalWeight = data.weights.reduce((sum, w) => sum + w, 0);
          const avgWeight =
            data.weights.length > 0
              ? (totalWeight / data.weights.length).toFixed(1)
              : "0";

          return {
            "Client ID": cId,
            "Client Name": name,
            "Home Studio": studioObj?.name || "Unknown Studio",
            "Sessions Completed": sessionsCount,
            "Average Exercise Resistance (lbs)": avgWeight,
            "Logs Recorded": data.weights.length,
          };
        },
      );

      const filename = `client_progress_${exportStartDate}_to_${exportEndDate}.csv`;
      const csv = Papa.unparse(progressData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toastSuccess(
        `Client Progress CSV (${filename}) downloaded successfully.`,
      );
    } catch (err: any) {
      console.error(err);
      toastError("Failed to export client progress: " + err.message);
    } finally {
      setIsExportingProgress(false);
    }
  };

  return {
    exportStartDate,
    setExportStartDate,
    exportEndDate,
    setExportEndDate,
    isExportingPayroll,
    isExportingAttendance,
    isExportingProgress,
    handleExportPayroll,
    handleExportAttendance,
    handleExportProgress,
  };
}
