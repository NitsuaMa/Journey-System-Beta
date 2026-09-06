import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  serverTimestamp,
  Timestamp,
  deleteDoc,
  startAfter,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { studioHour, formatStudioTime } from "../lib/studio-time";
import {
  User,
  Phone,
  Mail,
  MapPin,
  Activity,
  Contact,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Plus,
  Trash2,
  Save,
  Clock,
  Dumbbell,
  TrendingUp,
  AlertCircle,
  Play,
  Maximize,
  Calendar,
  Maximize2,
  Battery,
  CalendarDays,
  Star,
  Database,
  AlertTriangle,
  UserCheck,
  Target,
  Check,
  Search,
  Loader2,
} from "lucide-react";
import { generateMockClientWithHistory } from "../lib/mockDataGenerator";
import { motion, AnimatePresence } from "motion/react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  ReferenceLine,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { MachineSettingsDashboardModal } from "./MachineSettingsDashboardModal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EquipmentTab } from "../features/equipment";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROUTINE_TEMPLATES, RoutineTemplateType } from "../constants";
import { ClientFocusDashboard } from "./ClientFocusDashboard";
import { getCompletedSessionCount } from "../lib/session-count-cache";
import { ClinicalReviewTab } from "../features/clinical-review";
import { RoutinesTab } from "../features/routines";
import { ClientInfoSheet } from "./ClientInfoSheet";
import {
  Client,
  Machine,
  WorkoutSession,
  ExerciseLog,
  Routine,
  RoutineAdjustment,
  View,
  ClientMachineSetting,
  TrainerFocus,
  Trainer,
  ScheduleEntry,
  ProgressReport,
  ClinicalSafetyFlag,
  Studio,
  SessionNote,
} from "../types";
import { OperationType, handleFirestoreError } from "../lib/firestore-errors";
import { WorkoutChartGrid } from "./WorkoutChartGrid";
import { useToast } from "../contexts/ToastContext";
import { StrongConfirmationModal } from "./StrongConfirmationModal";
import { ClientHistoryCalendar } from "./ClientHistoryCalendar";
import { OccupationSelect } from "./OccupationSelect";
import { getErgonomicRisk } from "../data/occupational-matrix";
import {
  cn,
  parseSessionDate,
  getMillis,
  calculateExerciseVolume,
  getMuscleGroupColor,
  orderMachineSettings,
} from "../lib/utils";
import { RoutineBuilderView } from "./RoutineBuilderView";
import { CLINICAL_FLAGS_MATRIX } from "../data/clinical-matrix";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { useActiveSessionCheck } from "../hooks/useActiveSessionCheck";
import { useStudioMachineSettings } from "../hooks/useStudioMachineSettings";
import { resolveMachineOrder } from "../data/machine-display-order";
import {
  RecentJourneyView,
  toJourneyRows,
  toJourneySessions,
} from "../features/journey-grid";
import { isOwner as checkIsOwner } from "../lib/permissions";
import { EditRoutineDrawer } from "./EditRoutineDrawer";
import { ClientJournalTab } from "./journal/ClientJournalTab";
import {
  ProfileHeader,
  resolvePackage,
  useTopTrainer,
} from "../features/client-profile";
import { isOnRoster, useKaizenRoster } from "../features/trainer-profile";


/** Sessions per Firestore page for the profile's history (see the Journey tab). */
const SESSION_PAGE = 15;

export function ClientProfileView({
  clientId,
  isLoadingClient = false,
  clients,
  machines,
  authTrainer,
  trainers,
  onDelete,
  onSelectReport,
  setView,
  setSelectedClientId,
  hasQuotaError,
  user,
  studios,
  activeStudioId,
}: {
  clientId: string | null;
  /** True while the selected client document is still being fetched. */
  isLoadingClient?: boolean;
  clients: Client[];
  machines: Machine[];
  authTrainer?: Trainer | null;
  trainers: Trainer[];
  onDelete: (id: string) => void;
  onSelectReport: (id: string) => void;
  setView: (v: View, data?: { isIntroSession?: boolean }) => void;
  setSelectedClientId: (id: string | null) => void;
  hasQuotaError?: boolean;
  user?: any;
  studios?: Studio[];
  activeStudioId: string | null;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [reportToDelete, setReportToDelete] = useState<ProgressReport | null>(
    null,
  );
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [allLogs, setAllLogs] = useState<ExerciseLog[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [clientSettings, setClientSettings] = useState<
    Record<string, ClientMachineSetting>
  >({});
  const [trainerFocuses, setTrainerFocuses] = useState<TrainerFocus[]>([]);
  const [progressReports, setProgressReports] = useState<ProgressReport[]>([]);
  const [showMockConfirm, setShowMockConfirm] = useState(false);

  /*
   * KAIZEN ROSTER.
   *
   * `authTrainer` is captured at sign-in and never re-read, so it does not
   * see our own write. The roster lives on the trainer document that
   * `useTrainers` streams, so resolving against `trainers` is what makes the
   * toggle flip the moment Firestore acknowledges the change.
   */
  const liveAuthTrainer = useMemo(
    () => trainers.find((t) => t.id === authTrainer?.id) ?? authTrainer ?? null,
    [trainers, authTrainer],
  );
  const {
    add: addToKaizen,
    remove: removeFromKaizen,
    saving: kaizenSaving,
  } = useKaizenRoster(liveAuthTrainer);

  const performReportDelete = async () => {
    if (!reportToDelete?.id) return;
    try {
      await deleteDoc(doc(db, "progressReports", reportToDelete.id));
      toastSuccess("Progress report deleted successfully.");
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, "progressReports");
    } finally {
      setReportToDelete(null);
    }
  };

  const performMockGeneration = async () => {
    if (!authTrainer) return;
    try {
      const { clientName } = await generateMockClientWithHistory(
        authTrainer.id!,
        authTrainer.initials,
      );
      toastSuccess(`Success: Created ${clientName}`);
      window.location.reload();
    } catch (err: any) {
      toastError(err.message);
    } finally {
      setShowMockConfirm(false);
    }
  };

  const [scheduledSessions, setScheduledSessions] = useState<ScheduleEntry[]>(
    [],
  );
  const [isEditingFocus, setIsEditingFocus] = useState(false);
  const [isEditingSessionCount, setIsEditingSessionCount] = useState(false);
  const [sessionCountInput, setSessionCountInput] = useState("");
  const [focusForm, setFocusForm] = useState<Partial<TrainerFocus>>({
    category: "Path",
    notes: "",
  });
  const [selectedTimingSessionId, setSelectedTimingSessionId] = useState<
    string | null
  >(null);
  const [isSavingFocus, setIsSavingFocus] = useState(false);
  const [isEditingRoutine, setIsEditingRoutine] = useState<string | null>(null);
  const [routineEditData, setRoutineEditData] = useState<{
    name: string;
    machineIds: string[];
  }>({ name: "", machineIds: [] });
  const [highlightRoutine, setHighlightRoutine] = useState<"A" | "B" | null>(
    null,
  );

  // Routines Redesign additions
  const [routineAdjustments, setRoutineAdjustments] = useState<
    RoutineAdjustment[]
  >([]);
  const [selectedRoutineTodayId, setSelectedRoutineTodayId] = useState<
    string | null
  >(null);

  // Which routine the Edit Routine drawer is open against ("Routine A" /
  // "Routine B"), or null when closed. All the drawer's own state (machine
  // list, filters, reason, presets) now lives in EditRoutineDrawer.tsx.
  const [editRoutineTarget, setEditRoutineTarget] = useState<
    "Routine A" | "Routine B" | null
  >(null);

  // States for toggle B reason dialog
  const [isToggleReasonDialogOpen, setIsToggleReasonDialogOpen] =
    useState(false);
  const [pendingToggleBValue, setPendingToggleBValue] = useState<
    boolean | null
  >(null);
  const [toggleBReason, setToggleBReason] = useState<string>("");
  const [isSavingToggle, setIsSavingToggle] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [showFullChart, setShowFullChart] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(10);
  const [lastVisibleSession, setLastVisibleSession] = useState<any>(null);
  const [hasMoreSessions, setHasMoreSessions] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [calculatedSessionCount, setCalculatedSessionCount] =
    useState<number>(0);

  // Use the new soft lock handoff hook
  const { activeInProgressSession, isCheckingActiveSession } =
    useActiveSessionCheck(clientId);

  // Per-studio machine display order (Aug 2026): resolves a studio's own
  // custom Journey-grid ordering when it has one, falling back to the new
  // shared default sequence (data/machine-display-order.ts), and then to
  // any legacy machine.order value. This is a flat display-order concern
  // only — separate from the kinematic MOVEMENT_PATTERN_ORDER grouping
  // used by the Edit Routine drawer and Catalog, which is untouched here.
  const { settingsByMachineId: studioMachineSettingsById } =
    useStudioMachineSettings(activeStudioId);

  // Discard Session (round: In-Progress dropdown) — lets a trainer scrap
  // someone else's abandoned/stuck in-progress session right from the
  // profile, without having to take it over first. Mirrors the exact
  // deletion sequence WorkoutTrackerView's own "Scrap Session" flow uses
  // (logs, then notes, then the session doc itself) so a discarded session
  // leaves nothing orphaned behind.
  const [showDiscardActiveSessionConfirm, setShowDiscardActiveSessionConfirm] =
    useState(false);
  const [isDiscardingActiveSession, setIsDiscardingActiveSession] =
    useState(false);

  const handleDiscardActiveSession = async () => {
    if (!activeInProgressSession?.id) return;
    setIsDiscardingActiveSession(true);
    try {
      const sessionId = activeInProgressSession.id;
      const logsQ = query(
        collection(db, "exerciseLogs"),
        where("sessionId", "==", sessionId),
      );
      const logsSnap = await getDocs(logsQ);
      for (const logDoc of logsSnap.docs) {
        await deleteDoc(logDoc.ref);
      }
      const notesQ = query(
        collection(db, "sessionNotes"),
        where("sessionId", "==", sessionId),
      );
      const notesSnap = await getDocs(notesQ);
      for (const noteDoc of notesSnap.docs) {
        await deleteDoc(noteDoc.ref);
      }
      await deleteDoc(doc(db, "sessions", sessionId));

      if (
        localStorage.getItem("max_strength_active_session_id") === sessionId
      ) {
        localStorage.removeItem("max_strength_active_session_id");
      }

      toastSuccess("Active session discarded.");
      setShowDiscardActiveSessionConfirm(false);
    } catch (err) {
      console.error("Error discarding active session:", err);
      toastError("Couldn't discard that session. Try again.");
    } finally {
      setIsDiscardingActiveSession(false);
    }
  };

  const client = clients.find((c) => c.id === clientId);

  /**
   * A PRIMITIVE summary of the loaded sessions, not the array itself.
   *
   * The count effect below used to depend on `sessions`, and the profile's
   * snapshot listener rebuilds that array on every Firestore write (it maps
   * into a fresh array each time). During a bulk schedule sync that meant one
   * aggregation query per snapshot — the 429 storm. Depending on a number
   * instead means re-renders that did not actually change the session history
   * cost nothing.
   */
  const loadedCompletedCount = useMemo(
    () => sessions.filter((s) => s.status === "Completed").length,
    [sessions],
  );

  /**
   * Read through a ref so the reconciliation write does not feed itself.
   * `client.sessionCount` was previously a dependency, so the write below
   * changed the client document, which changed the prop, which re-ran the
   * effect, which queried again.
   */
  const clientSessionCountRef = useRef<number | undefined>(client?.sessionCount);
  useEffect(() => {
    clientSessionCountRef.current = client?.sessionCount;
  }, [client?.sessionCount]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    (async () => {
      // Cached + de-duplicated + quota-aware; see lib/session-count-cache.ts.
      const actualCount = await getCompletedSessionCount(clientId);
      // null means "could not determine right now" — never treat that as zero.
      if (cancelled || actualCount === null) return;

      setCalculatedSessionCount(actualCount);

      // Keep the client document in step with the real history length.
      if (clientSessionCountRef.current !== actualCount) {
        clientSessionCountRef.current = actualCount;
        updateDoc(doc(db, "clients", clientId), {
          sessionCount: actualCount,
        }).catch(console.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, loadedCompletedCount]);

  useEffect(() => {
    const handleOpenImport = () => setView("chart-importer" as any);
    window.addEventListener("open-bulk-import", handleOpenImport);
    return () =>
      window.removeEventListener("open-bulk-import", handleOpenImport);
  }, []);

  const [activeTab, setActiveTab] = useState("journey");

  /* ------------------------------------------------------------------ *
   * HEADER FACTS (Sep 2026 redesign)
   *
   * Top Trainer reads the persisted tally on the client document instead of
   * counting whoever coached the ten sessions this view happens to have
   * loaded — which was wrong for every client with more than ten sessions.
   * The package/remaining figure trusts Mindbody first (membership pull vs
   * booking pass snapshot, whichever is fresher) and falls back to the
   * app's own `remainingSessions`. Both are pure functions with tests in
   * src/features/client-profile/.
   * ------------------------------------------------------------------ */
  const topTrainer = useTopTrainer(client, trainers, sessions, {
    enabled: !hasQuotaError,
  });
  const clientPackage = useMemo(
    () => resolvePackage(client, scheduledSessions),
    [client, scheduledSessions],
  );

  function getTrainerChipStyles(initials: string) {
    if (!initials) return "bg-ink-l2 text-white";
    const colors = [
      "bg-cyan text-white",
      "bg-cta text-white",
      "bg-green text-ink-l1",
      "bg-amber text-white",
      "bg-ink-l2 text-white",
    ];
    let hash = 0;
    for (let i = 0; i < initials.length; i++) {
      hash = initials.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  const [clientNotesInput, setClientNotesInput] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);

  const [activeMachine, setActiveMachine] = useState<string | null>(null);
  const [selectedChartMachines, setSelectedChartMachines] = useState<string[]>(
    [],
  );
  const [hasInitializedChartMachines, setHasInitializedChartMachines] =
    useState(false);
  const [infoForm, setInfoForm] = useState<Partial<Client>>({});
  const [newEventForm, setNewEventForm] = useState<{
    date: string;
    title: string;
    type: any;
    notes: string;
  }>({
    date: new Date().toISOString().split("T")[0],
    title: "",
    type: "Other",
    notes: "",
  });
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [stagedMachineIds, setStagedMachineIds] = useState<
    Record<string, string[]>
  >({});
  const [isSavingRoutine, setIsSavingRoutine] = useState<
    Record<string, boolean>
  >({});
  const [routineBuilderTarget, setRoutineBuilderTarget] = useState<
    string | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingSettings, setEditingSettings] = useState<{
    machineId: string;
    settings: Record<string, string>;
  } | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [matrixRoutineFilter, setMatrixRoutineFilter] = useState<string>("all");
  const SESSIONS_PER_PAGE = 3;

  const handleUpdateMachineSettings = async () => {
    if (!editingSettings || !clientId) return;
    setIsSavingSettings(true);
    try {
      const settingId = `${clientId}_${editingSettings.machineId}`;
      await setDoc(
        doc(db, "clientMachineSettings", settingId),
        {
          clientId,
          machineId: editingSettings.machineId,
          settings: editingSettings.settings,
          updatedBy: auth.currentUser?.email || "Unknown",
          updatedAt: serverTimestamp(),
          studioId: clients.find((c) => c.id === clientId)?.homeStudioId || "",
        },
        { merge: true },
      );
      setEditingSettings(null);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `clientMachineSettings/${editingSettings.machineId}`,
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  const formatToMMDDYYYY = (dateVal: any) => {
    if (!dateVal) return "";
    const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
    if (isNaN(d.getTime())) return "";
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  };

  useEffect(() => {
    if (client) {
      setClientNotesInput(client.notes || "");
      setInfoForm({
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email || "",
        phone: client.phone || "",
        // Selects start empty — see handleSaveInfo, which drops "" so an
        // untouched dropdown never writes a default into the client record.
        gender: client.gender || "",
        height: client.height || "",
        weight: client.weight || "",
        age: client.age ?? null,
        occupation: client.occupation || "",
        isRetired: client.isRetired ?? false,
        clinicalProfile: client.clinicalProfile || [],
        clinicalFlags: client.clinicalFlags || [],
        clinicalNotes: client.clinicalNotes || "",
        activityLevel: client.activityLevel || "",
        trainingPedigree: client.trainingPedigree || "",
        recoveryMetric: client.recoveryMetric || "",
        emergencyContactName: client.emergencyContactName || "",
        emergencyContactPhone: client.emergencyContactPhone || "",
        globalNotes: client.globalNotes || "",
        isActive: client.isActive ?? true,
        isRoutineBActive: client.isRoutineBActive ?? false,
        consultationCompleted: client.consultationCompleted ?? false,
        discoveryNotes: client.discoveryNotes || "",
        packageTier: client.packageTier || "",
        remainingSessions: client.remainingSessions ?? 0,
        firstSessionDate: client.firstSessionDate || null,
        firstSessionDateRaw: formatToMMDDYYYY(client.firstSessionDate),
      });
    }
  }, [client]);

  const handleSaveInfo = async () => {
    if (!clientId) return;
    setIsSavingInfo(true);
    try {
      const sanitizedData = { ...infoForm };

      // Ensure age is a number or null, not an empty string
      if (sanitizedData.age === "" || sanitizedData.age === undefined) {
        delete sanitizedData.age;
      } else {
        const parsed = parseInt(sanitizedData.age as any, 10);
        sanitizedData.age = isNaN(parsed) ? null : parsed;
      }

      // Ensure remainingSessions is a number
      if (sanitizedData.remainingSessions !== undefined) {
        const parsed = parseInt(sanitizedData.remainingSessions as any, 10);
        sanitizedData.remainingSessions = isNaN(parsed) ? 0 : parsed;
      }

      // Parse firstSessionDate from typed MM/DD/YYYY if present
      if (sanitizedData.firstSessionDateRaw) {
        const cleanRaw = sanitizedData.firstSessionDateRaw.replace(/\D/g, "");
        if (cleanRaw.length === 8) {
          const m = parseInt(cleanRaw.slice(0, 2), 10);
          const d_val = parseInt(cleanRaw.slice(2, 4), 10);
          const y = parseInt(cleanRaw.slice(4, 8), 10);
          if (m >= 1 && m <= 12 && d_val >= 1 && d_val <= 31 && y >= 1900) {
            const selectedDate = new Date(y, m - 1, d_val);
            sanitizedData.firstSessionDate = Timestamp.fromDate(selectedDate);
          }
        } else if (cleanRaw.length === 6) {
          const m = parseInt(cleanRaw.slice(0, 2), 10);
          const d_val = parseInt(cleanRaw.slice(2, 4), 10);
          let y = parseInt(cleanRaw.slice(4, 6), 10);
          if (m >= 1 && m <= 12 && d_val >= 1 && d_val <= 31) {
            y = y < 50 ? 2000 + y : 1900 + y;
            const selectedDate = new Date(y, m - 1, d_val);
            sanitizedData.firstSessionDate = Timestamp.fromDate(selectedDate);
          }
        }
      }
      delete (sanitizedData as any).firstSessionDateRaw;

      // Cleanup other potentially empty strings to null or delete them if rules prefer
      Object.keys(sanitizedData).forEach((key) => {
        if ((sanitizedData as any)[key] === undefined) {
          delete (sanitizedData as any)[key];
        }
      });

      // Dropdowns that were never touched stay "" in the form. Never persist
      // that — leave the field alone so the record keeps whatever it had.
      const SELECT_FIELDS: (keyof typeof sanitizedData)[] = [
        "gender",
        "activityLevel",
        "trainingPedigree",
        "recoveryMetric",
        "packageTier",
      ];
      SELECT_FIELDS.forEach((key) => {
        if ((sanitizedData as any)[key] === "") {
          delete (sanitizedData as any)[key];
        }
      });

      await updateDoc(doc(db, "clients", clientId), {
        ...sanitizedData,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    } finally {
      setIsSavingInfo(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!clientId) return;
    setIsSavingNotes(true);
    try {
      await updateDoc(doc(db, "clients", clientId), {
        notes: clientNotesInput,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const formatDateForInput = (dateVal: any) => {
    if (!dateVal) return "";
    const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const handleStartDateChange = async (newVal: string) => {
    if (!clientId || !newVal) return;
    try {
      let selectedDate: Date;
      if (newVal.includes("/")) {
        const parts = newVal.split("/");
        const month = parseInt(parts[0], 10);
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        selectedDate = new Date(year, month - 1, day);
      } else {
        selectedDate = new Date(newVal + "T00:00:00");
      }
      const timestamp = Timestamp.fromDate(selectedDate);
      await updateDoc(doc(db, "clients", clientId), {
        firstSessionDate: timestamp,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    }
  };

  const handleAddEvent = async () => {
    if (!clientId || !client || !newEventForm.title || !newEventForm.date)
      return;
    setIsSavingEvent(true);
    try {
      let priority: "High" | "Medium" | "Low" = "Low";
      if (
        newEventForm.type === "Progress Report" ||
        newEventForm.type === "InBody Scan"
      )
        priority = "High";
      else if (newEventForm.type === "Routine Change") priority = "Medium";

      const newEvent = {
        id: Math.random().toString(36).substring(2, 9),
        ...newEventForm,
        priority,
        createdAt: new Date().toISOString(),
      };

      const updatedEvents = [...(client.events || []), newEvent];
      await updateDoc(doc(db, "clients", clientId), {
        events: updatedEvents,
        updatedAt: serverTimestamp(),
      });
      setNewEventForm({
        date: new Date().toISOString().split("T")[0],
        title: "",
        type: "Other",
        notes: "",
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    } finally {
      setIsSavingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!clientId || !client?.events) return;
    try {
      const updatedEvents = client.events.filter((e) => e.id !== eventId);
      await updateDoc(doc(db, "clients", clientId), {
        events: updatedEvents,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    }
  };

  const handleSaveSessionCount = async () => {
    if (!clientId) return;
    const num = parseInt(sessionCountInput, 10);
    if (isNaN(num)) return;

    try {
      await updateDoc(doc(db, "clients", clientId), {
        sessionCount: num,
        updatedAt: serverTimestamp(),
      });
      setIsEditingSessionCount(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    }
  };

  const handleToggleRoutineB = async (checked: boolean) => {
    if (!clientId) return;
    try {
      await updateDoc(doc(db, "clients", clientId), {
        isRoutineBActive: checked,
        updatedAt: serverTimestamp(),
      });
      setInfoForm((prev) => ({ ...prev, isRoutineBActive: checked }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `clients/${clientId}`);
    }
  };

  const toggleMachineInRoutine = (routineName: string, machineId: string) => {
    const current = stagedMachineIds[routineName] || [];
    const next = current.includes(machineId)
      ? current.filter((id) => id !== machineId)
      : [...current, machineId];

    setStagedMachineIds((prev) => ({ ...prev, [routineName]: next }));
  };

  const handleSaveRoutineConfig = async (routineName: string) => {
    if (!clientId) return;
    const machineIds = stagedMachineIds[routineName] || [];

    setIsSavingRoutine((prev) => ({ ...prev, [routineName]: true }));
    try {
      const existing = routines.find((r) => r.name === routineName);
      if (existing) {
        await updateDoc(doc(db, "routines", existing.id!), {
          machineIds,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "routines"), {
          clientId,
          name: routineName,
          machineIds,
          createdAt: serverTimestamp(),
          studioId: clients.find((c) => c.id === clientId)?.homeStudioId || "",
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "routines");
    } finally {
      setIsSavingRoutine((prev) => ({ ...prev, [routineName]: false }));
    }
  };

  const handleApplyTemplate = (
    templateType: RoutineTemplateType,
    routineName: string,
  ) => {
    if (!clientId) return;

    const templateNames = ROUTINE_TEMPLATES[templateType];
    const machineIds = templateNames
      .map(
        (name) =>
          machines.find((m) => m.name === name || m.fullName === name)?.id,
      )
      .filter((id): id is string => !!id);

    setStagedMachineIds((prev) => ({ ...prev, [routineName]: machineIds }));

    if (routineName?.includes("Routine B")) {
      handleToggleRoutineB(true);
    }
  };

  useEffect(() => {
    // Clear first. This view is not remounted between clients, and the fetch
    // below only ever WRITES on resolve — so between switching client and the
    // round-trip landing, the previous client's routines were still in state
    // and the Journey tab's A/B filters resolved against them.
    setRoutines([]);
    if (!clientId || hasQuotaError) return;

    const fetchRoutines = async () => {
      try {
        const routinesQuery = query(
          collection(db, "routines"),
          where("clientId", "==", clientId),
        );
        const snap = await getDocs(routinesQuery);
        const routinesData = snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Routine,
        );
        setRoutines(routinesData);

        setStagedMachineIds((prev) => {
          const newStaged: Record<string, string[]> = { ...prev };
          routinesData.forEach((r) => {
            if (!prev[r.name]) {
              newStaged[r.name] = r.machineIds;
            }
          });
          return newStaged;
        });
      } catch (error: any) {
        handleFirestoreError(error, OperationType.GET, "routines");
      }
    };

    fetchRoutines();
  }, [clientId, hasQuotaError]);

  useEffect(() => {
    if (!clientId || hasQuotaError) return;

    const q = query(
      collection(db, "routineAdjustments"),
      where("clientId", "==", clientId),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const adjustments = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as RoutineAdjustment[];
        // Sort desc by createdAt, handling firestore Timestamp properly
        adjustments.sort((a, b) => {
          const timeA =
            a.createdAt?.toMillis?.() ||
            (typeof a.createdAt === "number" ? a.createdAt : 0);
          const timeB =
            b.createdAt?.toMillis?.() ||
            (typeof b.createdAt === "number" ? b.createdAt : 0);
          return timeB - timeA;
        });
        setRoutineAdjustments(adjustments);
      },
      (error) => {
        console.error("Error fetching routine adjustments:", error);
      },
    );

    return () => unsubscribe();
  }, [clientId, hasQuotaError]);

  useEffect(() => {
    if (activeInProgressSession?.routineId) {
      setSelectedRoutineTodayId(activeInProgressSession.routineId);
    } else if (client?.preferredTodayRoutineId) {
      setSelectedRoutineTodayId(client.preferredTodayRoutineId);
    } else {
      setSelectedRoutineTodayId(null);
    }
  }, [activeInProgressSession?.routineId, client?.preferredTodayRoutineId]);

  const handlePromptToggleB = (checked: boolean) => {
    setPendingToggleBValue(checked);
    setToggleBReason("");
    setIsToggleReasonDialogOpen(true);
  };

  const handleConfirmToggleB = async () => {
    if (pendingToggleBValue === null || !clientId) return;
    if (toggleBReason.trim().length < 3) return;

    setIsSavingToggle(true);
    try {
      await updateDoc(doc(db, "clients", clientId), {
        isRoutineBActive: pendingToggleBValue,
      });

      const routineName = "Routine B";
      let routine = routines.find((r) => r.name === routineName);
      let routineId = routine?.id || "temp-b";

      if (routineId === "temp-b") {
        const docRef = await addDoc(collection(db, "routines"), {
          clientId,
          name: routineName,
          machineIds: [],
          createdAt: serverTimestamp(),
          studioId: client?.homeStudioId || activeStudioId || "",
        });
        routineId = docRef.id;
      }

      await addDoc(collection(db, "routineAdjustments"), {
        clientId,
        routineId,
        previousMachineIds: routine?.machineIds || [],
        newMachineIds: routine?.machineIds || [],
        trainerId: authTrainer?.id || "unknown",
        notes: toggleBReason,
        studioId: client?.homeStudioId || activeStudioId || "",
        changeType: pendingToggleBValue ? "enabled" : "disabled",
        createdAt: serverTimestamp(),
      });

      if (client) {
        client.isRoutineBActive = pendingToggleBValue;
      }

      // Re-trigger routines fetch
      const qRoutines = query(
        collection(db, "routines"),
        where("clientId", "==", clientId),
      );
      const snap = await getDocs(qRoutines);
      setRoutines(
        snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Routine),
      );

      setIsToggleReasonDialogOpen(false);
      setToggleBReason("");
    } catch (err) {
      console.error("Error toggling Routine B:", err);
    } finally {
      setIsSavingToggle(false);
    }
  };

  const handleUseToday = async (routine: Routine) => {
    if (!clientId) return;

    let rotId = routine.id;
    if (rotId.startsWith("temp-")) {
      const rotName = rotId === "temp-a" ? "Routine A" : "Routine B";
      const docRef = await addDoc(collection(db, "routines"), {
        clientId,
        name: rotName,
        machineIds: [],
        createdAt: serverTimestamp(),
        studioId: client?.homeStudioId || activeStudioId || "",
      });
      rotId = docRef.id;

      const qRoutines = query(
        collection(db, "routines"),
        where("clientId", "==", clientId),
      );
      const snap = await getDocs(qRoutines);
      setRoutines(
        snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Routine),
      );
    }

    try {
      await updateDoc(doc(db, "clients", clientId), {
        preferredTodayRoutineId: rotId,
      });

      if (activeInProgressSession?.id) {
        await updateDoc(doc(db, "sessions", activeInProgressSession.id), {
          routineId: rotId,
        });
      }

      setSelectedRoutineTodayId(rotId || null);
    } catch (err) {
      console.error("Error setting routine today:", err);
    }
  };

  const fetchLogsForSessions = async (sessionIds: string[]) => {
    if (sessionIds.length === 0) return [];
    const chunks = [];
    for (let i = 0; i < sessionIds.length; i += 10) {
      chunks.push(sessionIds.slice(i, i + 10));
    }
    let fetchedLogs: ExerciseLog[] = [];
    for (const chunk of chunks) {
      const qs = query(
        collection(db, "exerciseLogs"),
        where("sessionId", "in", chunk),
      );
      const snap = await getDocs(qs);
      fetchedLogs = [
        ...fetchedLogs,
        ...snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as ExerciseLog,
        ),
      ];
    }
    return fetchedLogs;
  };

  useEffect(() => {
    if (!clientId || hasQuotaError) return;

    if (activeTab !== "journey" && activeTab !== "history") {
      return;
    }

    const fetchInitialSessions = async () => {
      try {
        // 2. Firebase Query Limits & Pagination
        // The first page is 15 sessions: the Journey grid shows fourteen
        // columns at once (Sep 2026 density round) and the fifteenth keeps
        // the trend glyph on the oldest visible column honest.
        const sessionsQuery = query(
          collection(db, "sessions"),
          where("clientId", "==", clientId),
          orderBy("date", "desc"),
          limit(SESSION_PAGE),
        );

        const sessionSnap = await getDocs(sessionsQuery);
        const docs = sessionSnap.docs;

        if (!docs.length) {
          setSessions([]);
          setAllLogs([]);
          setHasMoreSessions(false);
          return;
        }

        setLastVisibleSession(docs[docs.length - 1]);
        setHasMoreSessions(docs.length === SESSION_PAGE);

        const liveSessionsData = docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as WorkoutSession,
        );

        // Merge gracefully to not erase older paginated history if coach loaded more
        setSessions((prev: WorkoutSession[]) => {
          const merged = new Map(prev.map((s) => [s.id, s]));
          liveSessionsData.forEach((s) => merged.set(s.id, s));
          const finalArr = Array.from(merged.values());
          finalArr.sort(
            (a, b) => parseSessionDate(b.date) - parseSessionDate(a.date),
          );
          return finalArr;
        });

        const sessionIds = liveSessionsData.map((s) => s.id!).filter(Boolean);
        const newLogs = await fetchLogsForSessions(sessionIds);

        setAllLogs((prev) => {
          const merged = new Map(prev.map((l) => [l.id, l]));
          newLogs.forEach((l) => merged.set(l.id, l));
          return Array.from(merged.values());
        });
      } catch (error: any) {
        handleFirestoreError(error, OperationType.GET, "sessions");
      }
    };

    const fetchSessionNotesObj = async () => {
      if (!clientId) return;
      try {
        const notesQ = query(
          collection(db, "sessionNotes"),
          where("clientId", "==", clientId),
          orderBy("createdAt", "desc"),
          limit(50),
        );
        const snap = await getDocs(notesQ);
        const notesData = snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as SessionNote,
        );
        setSessionNotes(notesData);
      } catch (error) {
        console.warn("Could not fetch session notes:", error);
      }
    };

    fetchInitialSessions();
    fetchSessionNotesObj();
  }, [clientId, activeTab, hasQuotaError]);

  const handleLoadMoreHistory = async () => {
    if (!lastVisibleSession || !hasMoreSessions || isLoadingMore || !clientId)
      return;
    setIsLoadingMore(true);
    try {
      const moreQuery = query(
        collection(db, "sessions"),
        where("clientId", "==", clientId),
        orderBy("date", "desc"),
        startAfter(lastVisibleSession),
        limit(SESSION_PAGE),
      );
      const snap = await getDocs(moreQuery);
      if (snap.empty) {
        setHasMoreSessions(false);
        return;
      }

      setLastVisibleSession(snap.docs[snap.docs.length - 1]);
      setHasMoreSessions(snap.docs.length === SESSION_PAGE);

      const moreSessionsData = snap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as WorkoutSession,
      );

      const sessionIds = moreSessionsData.map((s) => s.id!).filter(Boolean);
      const moreLogs = await fetchLogsForSessions(sessionIds);

      setSessions((prev) => {
        const out = [...prev, ...moreSessionsData].sort(
          (a, b) => parseSessionDate(b.date) - parseSessionDate(a.date),
        );
        return Array.from(new Map(out.map((s) => [s.id, s])).values());
      });
      setAllLogs((prev) => [...prev, ...moreLogs]);
    } catch (err) {
      console.error("Error loading older history", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  /* ------------------------------------------------------------------ *
   * JOURNEY GRID (client profile -> Journey tab)
   *
   * The grid itself lives in src/features/journey-grid. This block only
   * adapts the profile's Firestore state into the grid's view models:
   *   - sessions are numbered from the history length (not the stored
   *     sessionNumber), exactly as the old header did, so deleted or
   *     imported logs never leave gaps in the numbering;
   *   - rows follow the studio's display order and carry the ordered
   *     settings chips, the ★ core-lift flag and an alert flag when the
   *     client has an important machine note.
   * Start / Low / Next are gone as columns: Start and Low live in the
   * grid's Analytics column, and the prescribed weight now only ever shows
   * as the pre-filled value in the Active Session's Today column.
   * ------------------------------------------------------------------ */
  const journeyGridSessions = useMemo(() => {
    const totalRecords = Math.max(calculatedSessionCount, sessions.length);
    return toJourneySessions(
      sessions.map((s, idx) => ({ ...s, sessionNumber: totalRecords - idx })),
    );
  }, [sessions, calculatedSessionCount]);

  /**
   * Routine A / B machine ids, for the Journey tab's filters. Matched on the
   * routine NAME containing its letter, which is how the rest of this view
   * already tells the two apart.
   */
  const routineAMachineIds = useMemo(
    () =>
      routines.find((r) => (r.name || "").toUpperCase().includes("A"))?.machineIds ?? [],
    [routines],
  );
  const routineBMachineIds = useMemo(
    () =>
      routines.find((r) => (r.name || "").toUpperCase().includes("B"))?.machineIds ?? [],
    [routines],
  );

  const journeyGridRows = useMemo(() => {
    const ordered = [...machines].sort(
      (a, b) =>
        resolveMachineOrder(
          a.id,
          a.order,
          a.id ? studioMachineSettingsById[a.id]?.order : undefined,
        ) -
        resolveMachineOrder(
          b.id,
          b.order,
          b.id ? studioMachineSettingsById[b.id]?.order : undefined,
        ),
    );
    const currentStudio = studios?.find((st) => st.id === activeStudioId);
    // Marker 7: the Big Five star is gone from the grid. Every machine in
    // this method is a core lift; a star on five of them said the other
    // sixteen were optional, which is not what the prescription means.
    return toJourneyRows(ordered, allLogs, clientSettings).map((row) => {
      const machine = ordered.find((m) => m.id === row.machine.id);
      if (!machine) return row;
      const settings = clientSettings[machine.id!]?.settings || {};
      const stdSettings =
        currentStudio?.machineSettings?.[machine.id!] ||
        machine.standardSettings ||
        {};
      const entries = orderMachineSettings(
        settings,
        stdSettings,
        machine.settingOptions || [],
      );
      return {
        ...row,
        machine: {
          ...row.machine,
          settings: entries.length
            ? Object.fromEntries(entries.map(([k, v]) => [k, v]))
            : undefined,
          settingLabels: entries.length
            ? Object.fromEntries(entries.map(([k, , full]) => [k, full]))
            : undefined,
          alert: !!clientSettings[machine.id!]?.machineNotes?.some(
            (n) => n.isImportant,
          ),
        },
      };
    });
  }, [
    machines,
    allLogs,
    clientSettings,
    studioMachineSettingsById,
    studios,
    activeStudioId,
  ]);

  /** Tapping a machine name in the grid opens its settings editor, as the old row did. */
  const openJourneyMachineSettings = useCallback(
    (machineId: string | null) => {
      if (!machineId) return;
      const currentSettings = clientSettings[machineId]?.settings || {};
      setEditingSettings({ machineId, settings: { ...currentSettings } });
    },
    [clientSettings],
  );

  useEffect(() => {
    if (!clientId) return;

    const settingsQ = query(
      collection(db, "clientMachineSettings"),
      where("clientId", "==", clientId),
    );

    const unsubscribe = onSnapshot(
      settingsQ,
      (snap) => {
        const settingsMap: Record<string, ClientMachineSetting> = {};
        snap.docs.forEach((doc) => {
          const data = { id: doc.id, ...doc.data() } as ClientMachineSetting;
          settingsMap[data.machineId] = data;
        });
        setClientSettings(settingsMap);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, "clientMachineSettings");
      },
    );

    return () => unsubscribe();
  }, [clientId]);

  useEffect(() => {
    if (!clientId || hasQuotaError) return;
    if (activeTab !== "journey" && activeTab !== "journal") return;

    const fetchFocuses = async () => {
      try {
        const focusQ = query(
          collection(db, "trainerFocuses"),
          where("clientId", "==", clientId),
          orderBy("updatedAt", "desc"),
          limit(50),
        );
        const snap = await getDocs(focusQ);
        setTrainerFocuses(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as TrainerFocus,
          ),
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "trainerFocuses");
      }
    };

    fetchFocuses();

  }, [clientId, activeTab]);

  useEffect(() => {
    if (!clientId || hasQuotaError || !user) return;
    // The archive renders in the Journal tab as well as Clinical — gating
    // this on "clinical" alone is why it always looked empty there.
    if (activeTab !== "clinical" && activeTab !== "journal") return;

    const q = query(
      collection(db, "progressReports"),
      where("clientId", "==", clientId),
      orderBy("createdAt", "desc"),
      limit(50),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setProgressReports(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as ProgressReport,
          ),
        );
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.GET, "progressReports");
      },
    );

    return () => unsubscribe();
  }, [clientId, activeTab, user?.uid]);

  useEffect(() => {
    if (!clientId || !user) return;
    const fetchSchedules = async () => {
      try {
        const q = query(
          collection(db, "schedules"),
          where("clientId", "==", clientId),
          where("startTime", ">=", Timestamp.now()),
          orderBy("startTime", "asc"),
          limit(50),
        );
        const snap = await getDocs(q);
        setScheduledSessions(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as ScheduleEntry,
          ),
        );
      } catch (error: any) {
        handleFirestoreError(error, OperationType.GET, "schedules");
      }
    };
    fetchSchedules();
  }, [clientId, user?.uid]);

  useEffect(() => {
    const myFocus = trainerFocuses.find((f) => f.trainerId === authTrainer?.id);
    if (myFocus) {
      setFocusForm({
        category: myFocus.category,
        notes: myFocus.notes,
      });
    }
  }, [trainerFocuses, authTrainer]);

  const handleSaveFocus = async () => {
    if (!clientId || !authTrainer) return;
    setIsSavingFocus(true);
    try {
      const myFocus = trainerFocuses.find(
        (f) => f.trainerId === authTrainer.id,
      );
      const focusData = {
        clientId,
        trainerId: authTrainer.id,
        trainerName: authTrainer.fullName,
        category: focusForm.category,
        notes: focusForm.notes,
        updatedAt: serverTimestamp(),
      };

      if (myFocus) {
        await updateDoc(doc(db, "trainerFocuses", myFocus.id!), focusData);
      } else {
        await addDoc(collection(db, "trainerFocuses"), focusData);
      }
      setIsEditingFocus(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, "trainerFocuses");
    } finally {
      setIsSavingFocus(false);
    }
  };

  const handleSaveRoutine = async () => {
    if (!clientId || !isEditingRoutine) return;

    const original = routines.find((r) => r.id === isEditingRoutine);
    if (!original) return;

    try {
      // 1. Update existing routine
      await updateDoc(doc(db, "routines", isEditingRoutine), {
        name: routineEditData.name,
        machineIds: routineEditData.machineIds,
        updatedAt: serverTimestamp(),
      });

      // 2. Log adjustment in backend for history
      await addDoc(collection(db, "routineAdjustments"), {
        routineId: isEditingRoutine,
        clientId,
        previousMachineIds: original.machineIds,
        newMachineIds: routineEditData.machineIds,
        trainerId: authTrainer?.id || "unknown",
        createdAt: serverTimestamp(),
        studioId: clients.find((c) => c.id === clientId)?.homeStudioId || "",
      });

      setIsEditingRoutine(null);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `routines/${isEditingRoutine}`,
      );
    }
  };

  const startEditRoutine = (routine: Routine) => {
    setIsEditingRoutine(routine.id!);
    setRoutineEditData({
      name: routine.name,
      machineIds: [...routine.machineIds],
    });
  };

  // Task 3: Aggressive Memoization
  const memoizedCompletedSessionsAsc = useMemo(() => {
    return [...sessions]
      .filter((s) => s.status === "Completed")
      .sort((a, b) => parseSessionDate(a.date) - parseSessionDate(b.date));
  }, [sessions]);

  const memoizedCompletedSessionsDesc = useMemo(() => {
    return [...memoizedCompletedSessionsAsc].reverse();
  }, [memoizedCompletedSessionsAsc]);

  const memoizedEfficiencySessions = useMemo(() => {
    return memoizedCompletedSessionsAsc.filter((s) => s.startTime && s.endTime);
  }, [memoizedCompletedSessionsAsc]);

  const memoizedMachineStatsByDate = useMemo(() => {
    const machineStatsByDate: Record<string, Record<string, number>> = {};
    const machineWeightsByDate: Record<string, Record<string, number>> = {};
    const machineBaselines: Record<string, number> = {};

    [...allLogs]
      .sort(
        (a, b) =>
          (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0),
      )
      .forEach((l) => {
        if (!l.weight) return;
        const w = parseInt(l.weight.toString() || "0");
        if (w > 0) {
          if (!machineBaselines[l.machineId]) {
            machineBaselines[l.machineId] = w;
          }
          const session = sessions.find((s) => s.id === l.sessionId);
          if (session && session.date) {
            const dateStr = new Date(
              parseSessionDate(session.date),
            ).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            if (!machineStatsByDate[dateStr]) {
              machineStatsByDate[dateStr] = {};
            }
            if (!machineWeightsByDate[dateStr]) {
              machineWeightsByDate[dateStr] = {};
            }
            const base = machineBaselines[l.machineId];
            machineStatsByDate[dateStr][l.machineId] =
              ((w - base) / base) * 100;
            machineWeightsByDate[dateStr][l.machineId] = w;
          }
        }
      });
    return { machineStatsByDate, machineWeightsByDate, machineBaselines };
  }, [allLogs, sessions]);

  const memoizedVolumeByDate = useMemo(() => {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const volumeByDate: Record<string, number> = {};

    memoizedCompletedSessionsAsc.forEach((session) => {
      const time =
        session.createdAt?.toMillis?.() || parseSessionDate(session.date);
      if (time >= sixtyDaysAgo.getTime()) {
        const sLogs = allLogs.filter((l) => l.sessionId === session.id);
        const totalVol = sLogs.reduce((acc, log) => {
          const w = parseInt(log.weight?.toString() || "0");
          const r = parseInt(log.reps?.toString() || "0");
          return acc + w * r;
        }, 0);
        const dateStr = session.date
          ? new Date(parseSessionDate(session.date)).toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" },
            )
          : "";
        if (dateStr) {
          volumeByDate[dateStr] = (volumeByDate[dateStr] || 0) + totalVol;
        }
      }
    });
    return volumeByDate;
  }, [memoizedCompletedSessionsAsc, allLogs]);

  if (!client) {
    // Three different situations used to collapse into one "select a client"
    // message, so opening a profile flashed an empty state while the document
    // was still being fetched.
    if (isLoadingClient)
      return (
        <div className="flex flex-col items-center justify-center p-20 gap-4">
          <div
            role="status"
            aria-label="Loading client profile"
            className="w-10 h-10 border-4 border-cyan border-t-transparent rounded-full animate-spin"
          />
          <p className="text-muted-foreground font-medium">
            Loading client profile...
          </p>
        </div>
      );

    if (clientId)
      return (
        <div className="flex flex-col items-center justify-center p-20 gap-4">
          <AlertCircle className="w-12 h-12 text-rose-500 opacity-40" />
          <p className="text-muted-foreground font-medium">
            This client could not be found. They may have been deleted.
          </p>
          <Button onClick={() => setView("clients")}>Back to Clients</Button>
        </div>
      );

    return (
      <div className="flex flex-col items-center justify-center p-20 gap-4">
        <AlertCircle className="w-12 h-12 text-muted-foreground opacity-20" />
        <p className="text-muted-foreground font-medium">
          Select a client to view their profile.
        </p>
        <Button onClick={() => setView("clients")}>Back to Clients</Button>
      </div>
    );
  }

  if (routineBuilderTarget) {
    return (
      <RoutineBuilderView
        client={client}
        onBack={() => setRoutineBuilderTarget(null)}
        onSaveRoutine={(machineIds) => {
          setStagedMachineIds((prev) => ({
            ...prev,
            [routineBuilderTarget]: machineIds,
          }));
          setRoutineBuilderTarget(null);
        }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-350 mx-auto space-y-2 pb-8 px-2 sm:px-4 bg-slate-50 dark:bg-slate-950 min-h-screen pt-4"
    >
      {/* Alerts / Notifications */}
      {(() => {
        if (client.requiresConsultation && !client.consultationCompleted) {
          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mb-2"
            >
              <div className="bg-[#5BC0BE]/10 border-2 border-[#5BC0BE]/20 rounded-3xl p-4 flex items-center gap-4 text-[#5BC0BE]">
                <AlertCircle className="w-6 h-6 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-tight">
                    Profile Setup Needed
                  </p>
                  <p className="text-[11px] font-bold opacity-80 uppercase tracking-widest mt-0.5">
                    Set up their routine in the 'Equipment' tab or head to
                    profile details to build their profile.
                  </p>
                </div>
              </div>
            </motion.div>
          );
        }

        if (progressReports.length === 0) {
          // Only show "Report Required" if client is older than 3 months
          const clientCreatedAt =
            client.createdAt?.toDate?.() ||
            (client.createdAt ? new Date(client.createdAt) : new Date());
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

          if (clientCreatedAt > threeMonthsAgo) {
            return null;
          }

          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
            >
              <div className="bg-red-500/10 border-2 border-red-500/20 rounded-3xl p-4 flex items-center gap-4 text-red-600">
                <AlertCircle className="w-6 h-6 shrink-0" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-tight">
                    Report Required
                  </p>
                  <p className="text-[11px] font-bold opacity-80">
                    This client has no progress report on file. Please perform
                    an evaluation.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="ml-auto text-[11px] font-medium uppercase hover:bg-red-500/10"
                  onClick={() => setView("progress-report")}
                >
                  Start Now
                </Button>
              </div>
            </motion.div>
          );
        }

        const lastDate = new Date(parseSessionDate(progressReports[0].date));
        const nextDueDate = new Date(lastDate);
        nextDueDate.setMonth(nextDueDate.getMonth() + 3);

        const today = new Date();
        const diffTime = nextDueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 21) {
          const isOverdue = diffDays < 0;
          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
            >
              <div
                className={`${isOverdue ? "bg-red-500/10 border-red-200 text-red-600" : "bg-amber-500/10 border-amber-200 text-amber-600"} border-2 rounded-3xl p-4 flex items-center gap-4`}
              >
                <AlertCircle className="w-6 h-6 shrink-0" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-tight">
                    Report Due {isOverdue ? "Yesterday" : `Soon`}
                  </p>
                  <p className="text-[11px] font-bold opacity-80">
                    {isOverdue
                      ? `The 3-month progress report was due on ${nextDueDate.toLocaleDateString()}.`
                      : `The next progress report is due on ${nextDueDate.toLocaleDateString()} (in ${diffDays} days).`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className={`ml-auto text-[11px] font-medium uppercase ${isOverdue ? "hover:bg-red-500/10" : "hover:bg-amber-500/10"}`}
                  onClick={() => setView("progress-report")}
                >
                  Schedule Report
                </Button>
              </div>
            </motion.div>
          );
        }
        return null;
      })()}

      {/* Header (Sep 2026 redesign) — identity, four facts, one action.
          Lives in src/features/client-profile/ProfileHeader.tsx; this view
          only hands it data and the session-start wiring. */}
      <ProfileHeader
        client={client}
        studioName={studios?.find((s) => s.id === client.homeStudioId)?.name}
        sessions={sessions}
        scheduledSessions={scheduledSessions}
        completedCount={calculatedSessionCount}
        topTrainer={topTrainer}
        pkg={clientPackage}
        activeInProgressSession={activeInProgressSession}
        isCheckingActiveSession={isCheckingActiveSession}
        kaizen={
          liveAuthTrainer && client.id
            ? {
                isOn: isOnRoster(liveAuthTrainer, client.id),
                busy: kaizenSaving,
                onToggle: () => {
                  if (!client.id) return;
                  if (isOnRoster(liveAuthTrainer, client.id)) {
                    void removeFromKaizen(client.id);
                  } else {
                    // Straight onto the roster with the default reason. A
                    // trainer mid-conversation with a client should not have
                    // to answer a form; the reason is editable on the profile.
                    void addToKaizen(client, "Progression");
                  }
                },
              }
            : undefined
        }
        onBack={() => {
          setSelectedClientId(null);
          setView("client-directory");
        }}
        onStartSession={() => {
          localStorage.removeItem("max_strength_active_session_id");
          setView("workouts");
        }}
        onTakeOverSession={() => {
          if (activeInProgressSession?.id) {
            localStorage.setItem(
              "max_strength_active_session_id",
              activeInProgressSession.id,
            );
          }
          setView("workouts");
        }}
        onViewCurrentSession={() => setView("workouts")}
        onDiscardSession={() => setShowDiscardActiveSessionConfirm(true)}
      />

      <Tabs
        value={activeTab}
        className="w-full flex-1 flex flex-col min-h-0"
        onValueChange={setActiveTab}
      >
        {/* Seven equal columns — Profile Details joined the row as "Details"
            (Sep 2026). Equal tracks (not content-sized) are what keep the row
            from ever scrolling sideways: at 834pt portrait each tab still
            gets ~115px, and the condensed display face fits "EQUIPMENT" in
            that with room. `truncate` is the belt to that suspender. */}
        <div className="mb-2 w-full">
          <div className="w-full pb-0.5">
            <TabsList className="bg-transparent p-0 grid grid-cols-7 w-full h-11! border-b border-slate-200 dark:border-slate-800 gap-0">
              {[
                { val: "journey", label: "Journey" },
                { val: "routines", label: "Routines" },
                { val: "equipment", label: "Equipment" },
                { val: "journal", label: "Journal" },
                { val: "history", label: "History" },
                { val: "clinical", label: "Clinical" },
                { val: "details", label: "Details" },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.val}
                  value={tab.val}
                  className="relative w-full h-11! px-1 sm:px-2 font-display italic text-[10px] sm:text-[13px] font-bold uppercase tracking-wider sm:tracking-widest text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-800/80 data-[state=active]:text-[#F06C22] dark:data-[state=active]:text-[#F06C22] transition-all text-center cursor-pointer select-none rounded-none border-b-2 border-transparent data-[state=active]:border-[#F06C22] truncate flex items-center justify-center"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        {/* Marker 13: the settings used to live in a 100dvh-340px box with
            its own scrollbar. Natural height now; the page scrolls. */}
        <TabsContent
          value="details"
          className="mt-0 focus-visible:outline-none"
        >
          {client && (
            <ClientInfoSheet
              variant="inline"
              isOpen
              onOpenChange={() => setActiveTab("journey")}
              client={client}
              authTrainer={authTrainer ?? null}
              defaultTab="identity"
              machines={machines}
              trainers={trainers}
              onOpenJournal={() => setActiveTab("journal")}
              onOpenReports={() => setActiveTab("journal")}
            />
          )}
        </TabsContent>
        <TabsContent
          value="equipment"
          className="mt-0 flex-1 overflow-hidden min-h-0 flex flex-col rounded-xl relative"
        >
          <EquipmentTab
            client={client}
            clientId={clientId}
            machines={machines}
            clientSettings={clientSettings}
            clientBodyWeight={parseInt(client?.weight || "150", 10)}
            allLogs={allLogs}
            sessions={sessions}
            activeStudioId={activeStudioId}
            authTrainer={authTrainer}
          />
        </TabsContent>
        {/* Marker 3: no `overflow-hidden`, no bounded height. The machine
            list is as long as it is and the PAGE scrolls to meet it. */}
        <TabsContent
          value="journey"
          className="mt-0 rounded-xl relative focus-visible:outline-none"
        >
          <RecentJourneyView
            sessions={journeyGridSessions}
            rows={journeyGridRows}
            hasMoreOnServer={hasMoreSessions}
            onLoadMore={handleLoadMoreHistory}
            loadingMore={isLoadingMore}
            layout="page"
            routineAMachineIds={routineAMachineIds}
            routineBMachineIds={routineBMachineIds}
            onSelectMachine={openJourneyMachineSettings}
          />
        </TabsContent>
        <TabsContent
          value="routines"
          className="mt-0 flex-1 min-h-0 focus-visible:outline-none"
        >
          {/* Both prescriptions as dense lists (features/routines). The
              mutations stay here: the tab only reports taps. */}
          <RoutinesTab
            client={client}
            clientId={clientId || ""}
            routines={routines}
            machines={machines}
            clientSettings={clientSettings}
            allLogs={allLogs}
            sessions={sessions}
            adjustments={routineAdjustments}
            trainers={trainers}
            selectedRoutineTodayId={selectedRoutineTodayId}
            isBActive={!!client?.isRoutineBActive}
            onEdit={(name) => setEditRoutineTarget(name)}
            onUseToday={handleUseToday}
            onToggleB={handlePromptToggleB}
            onSelectMachine={openJourneyMachineSettings}
            disabled={!!hasQuotaError}
          />

          {/* Dialog/Modal for Routine B Toggle Reason */}
          <Dialog
            open={isToggleReasonDialogOpen}
            onOpenChange={setIsToggleReasonDialogOpen}
          >
            <DialogContent
              showCloseButton={false}
              className="rounded-2xl max-w-md p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
            >
              <DialogHeader>
                <DialogTitle className="text-lg font-bold uppercase tracking-tight text-slate-950 dark:text-white font-display italic">
                  Reason Required for Protocol B Change
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 mt-1">
                  Please provide a brief justification to explain why you are{" "}
                  {pendingToggleBValue ? "enabling" : "disabling"} the optional
                  Routine B protocol for {client?.firstName}.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <Textarea
                  value={toggleBReason}
                  onChange={(e) => setToggleBReason(e.target.value)}
                  placeholder="e.g., Sandra is experiencing shoulder tightness; setting up B as a low-impact chest day."
                  rows={3}
                  className="rounded-xl border-div-l bg-slate-50/50 dark:bg-slate-950/20 text-xs text-slate-800 dark:text-neutral-200 resize-none"
                />
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-400 font-medium">
                    Be brief and clinical for Sandra's logs.
                  </span>
                  <span
                    className={cn(
                      "font-semibold tracking-wide",
                      toggleBReason.trim().length >= 3
                        ? "text-emerald-500"
                        : "text-amber-500",
                    )}
                  >
                    {toggleBReason.trim().length >= 3 ? "✓ Reason captured" : "Reason required"}
                  </span>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 border-t border-div-l/40 pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setIsToggleReasonDialogOpen(false)}
                  className="rounded-xl uppercase font-bold text-xs"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmToggleB}
                  disabled={toggleBReason.trim().length < 3 || isSavingToggle}
                  className="bg-cta text-white hover:bg-cta-strong rounded-xl uppercase font-bold text-xs shadow-md shadow-cta/15"
                >
                  {isSavingToggle ? "Saving..." : "Confirm Switch"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Discard Session confirmation (round: Discard Session option) —
              same delete sequence, same "are you sure" pattern as
              WorkoutTrackerView's own Scrap Session dialog, just reachable
              from the profile's In-Progress dropdown so a trainer can clear
              a stuck/abandoned session without opening it first. */}
          <Dialog
            open={showDiscardActiveSessionConfirm}
            onOpenChange={(v) => !isDiscardingActiveSession && setShowDiscardActiveSessionConfirm(v)}
          >
            <DialogContent className="sm:max-w-100 rounded-[32px] p-0 overflow-hidden border-none shadow-2xl dark:shadow-none">
              <div className="bg-white dark:bg-bg-dark p-8 text-slate-900 dark:text-white space-y-3">
                <div
                  className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center mb-2 transition-all",
                    isDiscardingActiveSession
                      ? "bg-red-500/20 text-red-500 animate-pulse"
                      : "bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]",
                  )}
                >
                  {isDiscardingActiveSession ? (
                    <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                  ) : (
                    <Trash2 className="w-6 h-6" />
                  )}
                </div>
                <h3 className="text-2xl font-black italic uppercase tracking-tight">
                  {isDiscardingActiveSession
                    ? "Discarding Session..."
                    : "Discard Active Session?"}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 font-medium text-sm leading-relaxed">
                  {isDiscardingActiveSession
                    ? "Scrapping all logged sets, timers, and notes. Cleaning database records..."
                    : `This will end and permanently clear the session ${
                        activeInProgressSession?.trainerInitials
                          ? `started by ${activeInProgressSession.trainerInitials}`
                          : "in progress"
                      }. All data logged so far will be scrapped and will not be recorded in the database.`}
                </p>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white dark:bg-bg-dark border-t border-slate-100 dark:border-slate-800">
                <Button
                  variant="outline"
                  disabled={isDiscardingActiveSession}
                  className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-surface-2 disabled:opacity-50"
                  onClick={() => setShowDiscardActiveSessionConfirm(false)}
                >
                  Keep Session
                </Button>
                <Button
                  disabled={isDiscardingActiveSession}
                  className="h-14 rounded-2xl font-black uppercase tracking-widest text-xs bg-red-600 text-white shadow-lg shadow-red-200 dark:shadow-none hover:bg-red-700 disabled:opacity-80 flex items-center justify-center gap-2"
                  onClick={handleDiscardActiveSession}
                >
                  {isDiscardingActiveSession ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Discarding...</span>
                    </>
                  ) : (
                    "Discard Session"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Edit Routine drawer — widened, with in-drawer A/B switching,
              a horizontal filter row, and two-tier Preset Routines. Lives in
              its own file now; this just mounts it and hands back the fresh
              routines list on save so the cards above stay in sync. */}
          <EditRoutineDrawer
            client={client || null}
            clientId={clientId}
            routines={routines}
            machines={machines}
            activeStudioId={activeStudioId}
            studioName={studios?.find((s) => s.id === activeStudioId)?.name}
            authTrainer={authTrainer}
            allLogs={allLogs}
            sessions={sessions}
            target={editRoutineTarget}
            onClose={() => setEditRoutineTarget(null)}
            onSaved={(updated) => setRoutines(updated)}
            onRequestActivateRoutineB={() => handlePromptToggleB(true)}
          />
        </TabsContent>
        <TabsContent
          value="journal"
          className="mt-0 flex-1 min-h-0 focus-visible:outline-none"
        >
          <ClientJournalTab
            clientId={clientId}
            client={client}
            machines={machines}
            trainers={trainers}
            authTrainer={authTrainer}
            progressReports={progressReports}
            onSelectReport={onSelectReport}
            onDeleteReport={setReportToDelete}
            onNewReport={() => setView("progress-report")}
            hasQuotaError={hasQuotaError}
          />
        </TabsContent>
        <TabsContent
          value="history"
          className="flex-1 min-h-100 relative pb-20 overflow-y-auto custom-scrollbar"
        >
          <div className="space-y-6">
            {clientId && (
              <div className="flex flex-col gap-4">
                <ClientHistoryCalendar
                  clientId={clientId}
                  clientHomeStudioId={client?.homeStudioId}
                  machines={machines}
                  trainers={trainers}
                  user={user}
                  allLogs={allLogs}
                  clientEvents={client?.events || []}
                />

                <div className="flex justify-center pb-8">
                  <Button
                    variant="outline"
                    onClick={() => setSessionLimit((prev) => prev + 30)}
                    className="border-[#38BDF8]/50 text-[#38BDF8] hover:bg-[#38BDF8]/10 font-bold tracking-widest uppercase text-[11px] h-12 rounded-2xl px-6"
                  >
                    Load More Sessions
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="clinical"
          className="mt-0 flex-1 min-h-125 focus-visible:outline-none"
        >
          {/* Sep 2026: nothing loads on open. The tab is a "Generate clinical
              report" gate with a date range; the report is compiled from
              exactly that window. See src/features/clinical-review/. */}
          {client && (
            <ClinicalReviewTab
              client={client}
              machines={machines}
              trainers={trainers}
              timeZone={
                studios?.find((s) => s.id === client.homeStudioId)?.timezone ||
                undefined
              }
              disabled={!!hasQuotaError}
            />
          )}
        </TabsContent>
        <TabsContent value="statistics_disabled" className="hidden">
          {/* Consistency & Training Frequency Insights */}
          {(() => {
            const completedSessions = sessions
              .filter((s) => s.status === "Completed")
              .sort(
                (a, b) => parseSessionDate(a.date) - parseSessionDate(b.date),
              );
            if (completedSessions.length === 0) return null;

            const firstDate = client.firstSessionDate
              ? new Date(
                  client.firstSessionDate?.toDate?.() ||
                    client.firstSessionDate,
                )
              : new Date(parseSessionDate(completedSessions[0].date));

            let totalRestDays = 0;
            let restIntervals = 0;
            for (let i = 1; i < completedSessions.length; i++) {
              const prev = parseSessionDate(completedSessions[i - 1].date);
              const curr = parseSessionDate(completedSessions[i].date);
              const diffDays = Math.floor(
                (curr - prev) / (1000 * 60 * 60 * 24),
              );
              if (diffDays > 0) {
                totalRestDays += diffDays;
                restIntervals++;
              }
            }
            const avgRestDays =
              restIntervals > 0
                ? (totalRestDays / restIntervals).toFixed(1)
                : "N/A";

            const timeRanges = { Morning: 0, Afternoon: 0, Evening: 0 };
            completedSessions.forEach((s) => {
              let hour = 12;
              if (s.startTime?.toDate) {
                hour = studioHour(s.startTime.toDate()) ?? 12;
              } else if (s.createdAt?.toDate) {
                hour = studioHour(s.createdAt.toDate()) ?? 12;
              }
              if (hour < 12) timeRanges.Morning++;
              else if (hour < 17) timeRanges.Afternoon++;
              else timeRanges.Evening++;
            });
            const favoriteTime = Object.keys(timeRanges).reduce((a, b) =>
              timeRanges[a as keyof typeof timeRanges] >
              timeRanges[b as keyof typeof timeRanges]
                ? a
                : b,
            );

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const sessionsPast30 = completedSessions.filter(
              (s) => parseSessionDate(s.date) >= thirtyDaysAgo.getTime(),
            ).length;
            const past30Weeks = 30 / 7;
            const avgPerWeek30 = (sessionsPast30 / past30Weeks).toFixed(1);

            const lifetimeDays = Math.max(
              1,
              Math.floor(
                (Date.now() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
              ),
            );
            const lifetimeWeeks = lifetimeDays / 7;
            const avgPerWeekLife = (
              completedSessions.length / Math.max(1, lifetimeWeeks)
            ).toFixed(1);

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="rounded-3xl overflow-hidden border-2 shadow-sm bg-linear-to-br from-card to-card hover:border-primary/30 transition-all group">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <CalendarDays className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">
                        Origin
                      </p>
                    </div>
                    <div className="text-2xl font-bold italic tracking-tighter text-foreground">
                      {firstDate.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground mt-1 opacity-60">
                      First Recorded App Session
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl overflow-hidden border-2 shadow-sm bg-linear-to-br from-card to-card hover:border-emerald-500/30 transition-all group">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      </div>
                      <p className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">
                        Frequency
                      </p>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="text-3xl font-bold italic tracking-tighter text-foreground">
                        {avgPerWeek30}
                      </div>
                      <span className="text-xs font-bold uppercase mb-1.5 opacity-60">
                        per week (30 Days)
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-emerald-600 mt-1 uppercase tracking-widest leading-none bg-emerald-500/10 w-fit px-2 py-1 rounded">
                      Lifetime: {avgPerWeekLife} / wk
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl overflow-hidden border-2 shadow-sm bg-linear-to-br from-card to-card hover:border-amber-500/30 transition-all group">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Battery className="w-4 h-4 text-amber-500" />
                      </div>
                      <p className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">
                        Recovery Avg
                      </p>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="text-3xl font-bold italic tracking-tighter text-foreground">
                        {avgRestDays}
                      </div>
                      <span className="text-xs font-bold uppercase mb-1.5 opacity-60">
                        days
                      </span>
                    </div>
                    <p className="text-[11px] font-bold text-amber-600 mt-1 uppercase tracking-widest leading-none bg-amber-500/10 w-fit px-2 py-1 rounded">
                      Between sessions
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl overflow-hidden border-2 shadow-sm bg-linear-to-br from-card to-card hover:border-indigo-500/30 transition-all group">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Clock className="w-4 h-4 text-indigo-500" />
                      </div>
                      <p className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground">
                        Preferred Time
                      </p>
                    </div>
                    <div className="text-2xl font-bold italic tracking-tighter text-foreground">
                      {favoriteTime}
                    </div>
                    <p className="text-[11px] font-bold text-indigo-600 mt-1 uppercase tracking-widest leading-none bg-indigo-500/10 w-fit px-2 py-1 rounded">
                      Routine Dominance
                    </p>
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          {/* Strength Journey Overall Growth Chart */}
          {(() => {
            const machineStatsByDate =
              memoizedMachineStatsByDate.machineStatsByDate;
            const machineWeightsByDate =
              memoizedMachineStatsByDate.machineWeightsByDate;
            const allDatesSet = new Set<string>();
            Object.keys(machineStatsByDate).forEach((d) => allDatesSet.add(d));

            const sortedDates = Array.from(allDatesSet).sort(
              (a, b) =>
                new Date(a + " " + new Date().getFullYear()).getTime() -
                new Date(b + " " + new Date().getFullYear()).getTime(),
            );

            let lastKnownStats: Record<string, number> = {};
            let lastKnownWeights: Record<string, number> = {};
            const seenMachines = new Set<string>();

            const growthChartData = sortedDates.map((dateStr) => {
              const currentStats = machineStatsByDate[dateStr];
              const currentWeights = machineWeightsByDate[dateStr];
              const row: any = { date: dateStr };
              machines.forEach((m) => {
                if (currentStats && currentStats[m.id!] !== undefined) {
                  row[m.id!] = Math.round(currentStats[m.id!] * 10) / 10;
                  row[m.id + "_weight"] = currentWeights[m.id!];
                  lastKnownStats[m.id!] = row[m.id!];
                  lastKnownWeights[m.id!] = row[m.id + "_weight"];

                  if (!seenMachines.has(m.id!)) {
                    row[m.id + "_isFirst"] = true;
                    seenMachines.add(m.id!);
                  }
                } else if (lastKnownStats[m.id!] !== undefined) {
                  row[m.id!] = lastKnownStats[m.id!];
                  row[m.id + "_weight"] = lastKnownWeights[m.id!];
                }
              });
              return row;
            });

            // Calculate total machine growths for the top 3 and average growth
            const machineGrowths: Array<{
              id: string;
              name: string;
              growth: number;
            }> = [];
            machines.forEach((m) => {
              if (
                lastKnownStats[m.id!] !== undefined &&
                lastKnownStats[m.id!] > 0
              ) {
                machineGrowths.push({
                  id: m.id!,
                  name: m.name,
                  growth: lastKnownStats[m.id!],
                });
              }
            });

            machineGrowths.sort((a, b) => b.growth - a.growth);

            // Initialize chart machines exactly once to all performed machines
            if (!hasInitializedChartMachines && seenMachines.size > 0) {
              setSelectedChartMachines(Array.from(seenMachines));
              setHasInitializedChartMachines(true);
            }

            const totalGrowth = machineGrowths.reduce(
              (sum, m) => sum + m.growth,
              0,
            );
            const avgGrowth =
              machineGrowths.length > 0
                ? Math.round(totalGrowth / machineGrowths.length)
                : 0;

            const CustomGrowthTooltip = ({ active, payload }: any) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-[#0A2E46] border border-slate-200 dark:border-slate-700 p-3 rounded-lg shadow-xl min-w-50">
                    <p className="text-[11px] uppercase tracking-widest text-[#68717A] mb-2">
                      {data.date}
                    </p>
                    <div className="space-y-2">
                      {payload.map((entry: any, index: number) => {
                        const machine = machines.find(
                          (m) => m.id === entry.dataKey,
                        );
                        if (!machine) return null;
                        const weight = data[entry.dataKey + "_weight"];
                        const baselineWeight =
                          memoizedMachineStatsByDate.machineBaselines[
                            machine.id!
                          ];
                        return (
                          <div
                            key={index}
                            className="flex flex-col text-xs bg-slate-900/50 p-1.5 rounded"
                          >
                            <div className="flex justify-between items-center w-full">
                              <span
                                style={{ color: entry.color }}
                                className="font-bold truncate max-w-30"
                              >
                                {machine.name}
                              </span>
                              <span className="font-bold text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                                +{entry.value}%
                              </span>
                            </div>
                            {weight !== undefined &&
                              baselineWeight !== undefined && (
                                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-[#68717A] mt-1">
                                  <span>
                                    Start:{" "}
                                    <span className="text-ink-d1 font-bold">
                                      {baselineWeight} lbs
                                    </span>
                                  </span>
                                  <span>→</span>
                                  <span>
                                    Current:{" "}
                                    <span className="text-ink-d1 font-bold">
                                      {weight} lbs
                                    </span>
                                  </span>
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return null;
            };

            const OriginDot = (props: any) => {
              const { cx, cy, payload, dataKey, stroke } = props;
              if (payload[dataKey + "_isFirst"] && cx && cy) {
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={stroke}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              }
              return null;
            };

            const getColorForMachine = (machineName: string) => {
              const lowerName = machineName.toLowerCase();
              if (lowerName.includes("neck")) return "#64748b"; // Slate (Neck)
              if (
                (lowerName.includes("press") && !lowerName.includes("leg")) ||
                lowerName.includes("raise") ||
                lowerName.includes("fly") ||
                lowerName.includes("tricep") ||
                lowerName.includes("dip")
              )
                return "#3b82f6"; // Steel Blue (Push)
              if (
                lowerName.includes("pull") ||
                lowerName.includes("row") ||
                lowerName.includes("bicep")
              )
                return "#f59e0b"; // Amber (Pull)
              if (
                lowerName.includes("ab") ||
                lowerName.includes("lumbar") ||
                lowerName.includes("torso") ||
                lowerName.includes("core")
              )
                return "#a855f7"; // Purple (Core)
              if (
                lowerName.includes("leg") ||
                lowerName.includes("hip") ||
                lowerName.includes("calf") ||
                lowerName.includes("thigh")
              )
                return "#10b981"; // Sage Green (Lower Body)

              return "#64748b"; // Fallback Slate
            };

            // Calculate filtered machines based on dropdown
            const activeChartMachines = machines.filter((m) =>
              selectedChartMachines.includes(m.id!),
            );

            return (
              <div className="space-y-6">
                {/* Average Growth Summary Card */}
                {machineGrowths.length > 0 && (
                  <Card className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 border-l-4 border-l-[#10b981]">
                    <CardContent className="p-6 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-[#10b981]/10 flex items-center justify-center">
                          <TrendingUp className="w-6 h-6 text-[#10b981]" />
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-widest font-bold text-slate-500">
                            Average Studio Growth
                          </p>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                            Total average increase across{" "}
                            {machineGrowths.length} machines
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <span className="text-emerald-500 font-bold text-3xl">
                          +{avgGrowth}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden bg-white dark:bg-slate-900">
                  <CardHeader className="p-8 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <CardTitle className="text-2xl font-bold uppercase italic tracking-tighter text-[#0A2E46] dark:text-slate-200 flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-[#F06C22]" />{" "}
                          Strength Journey
                        </CardTitle>
                        <CardDescription className="text-xs font-bold uppercase tracking-widest mt-2 text-slate-500">
                          Percentage Growth vs. Starting Weight
                        </CardDescription>
                      </div>

                      {/* Compare Machines Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white transition-colors h-9 px-4 py-2">
                          Compare Machines ({selectedChartMachines.length})
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-70 p-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-100 overflow-y-auto"
                        >
                          {machines
                            .filter((m) => seenMachines.has(m.id!))
                            .map((m) => {
                              const isSelected = selectedChartMachines.includes(
                                m.id!,
                              );
                              return (
                                <DropdownMenuItem
                                  key={m.id}
                                  className="flex items-center gap-2 py-2 cursor-pointer focus:bg-slate-50 dark:focus:bg-slate-800"
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    if (isSelected) {
                                      setSelectedChartMachines((prev) =>
                                        prev.filter((id) => id !== m.id),
                                      );
                                    } else {
                                      setSelectedChartMachines((prev) => [
                                        ...prev,
                                        m.id!,
                                      ]);
                                    }
                                  }}
                                >
                                  <div
                                    className={cn(
                                      "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                                      isSelected
                                        ? "bg-blue-500 border-blue-500"
                                        : "border-slate-300 dark:border-slate-600",
                                    )}
                                  >
                                    {isSelected && (
                                      <div className="w-2 h-2 rounded-sm bg-white" />
                                    )}
                                  </div>
                                  <span className="text-[11px] font-bold uppercase truncate flex-1">
                                    {m.name}
                                  </span>
                                  {machineGrowths.find(
                                    (x) => x.id === m.id,
                                  ) && (
                                    <span className="text-[11px] font-bold text-emerald-500">
                                      +
                                      {
                                        machineGrowths.find(
                                          (x) => x.id === m.id,
                                        )?.growth
                                      }
                                      %
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              );
                            })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8 h-137.5 bg-slate-50 dark:bg-slate-900/50">
                    {growthChartData.length > 0 &&
                    activeChartMachines.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={growthChartData}
                          margin={{ top: 20, right: 30, left: -10, bottom: 20 }}
                        >
                          <XAxis
                            dataKey="date"
                            stroke="#94a3b8"
                            tick={{
                              fill: "#64748b",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            tickMargin={15}
                            axisLine={{ stroke: "#e2e8f0", strokeWidth: 2 }}
                            tickLine={false}
                          />
                          <YAxis
                            stroke="#94a3b8"
                            tick={{
                              fill: "#64748b",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => `+${val}%`}
                            domain={[0, "auto"]}
                          />
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <RechartsTooltip content={<CustomGrowthTooltip />} />
                          <Legend
                            wrapperStyle={{ paddingTop: "20px" }}
                            onMouseEnter={(e) =>
                              setActiveMachine(e.dataKey as string)
                            }
                            onMouseLeave={() => setActiveMachine(null)}
                            onClick={(e) =>
                              setActiveMachine(
                                activeMachine === e.dataKey
                                  ? null
                                  : (e.dataKey as string),
                              )
                            }
                            iconType="circle"
                            iconSize={8}
                          />
                          {activeChartMachines.map((m, idx) => {
                            const hasData = growthChartData.some(
                              (d) => d[m.id!] !== undefined,
                            );
                            if (!hasData) return null;

                            const isActive = activeMachine === m.id;
                            const isFaded = activeMachine !== null && !isActive;
                            const color = getColorForMachine(m.name);

                            return (
                              <Line
                                key={m.id}
                                name={m.name} // Legend uses name
                                type="stepAfter" // Make it a step chart to show plateaus clearly
                                dataKey={m.id!}
                                stroke={color}
                                strokeWidth={isActive ? 4 : 2.5}
                                strokeOpacity={isFaded ? 0.15 : 1}
                                dot={<OriginDot stroke={color} />}
                                activeDot={{
                                  r: 6,
                                  fill: "#fff",
                                  stroke: color,
                                  strokeWidth: 2,
                                }}
                                connectNulls
                              />
                            );
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center opacity-30">
                        <TrendingUp className="w-12 h-12 text-[#68717A] mb-4" />
                        <p className="text-xs font-bold uppercase tracking-widest text-[#68717A]">
                          {growthChartData.length === 0
                            ? "Not enough data available"
                            : "Select machines to compare"}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          {/* 60-Day Global Volume Chart */}
          {(() => {
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

            const volumeByDate: Record<string, number> = {};
            const completedSessions = sessions
              .filter((s) => s.status === "Completed")
              .reverse(); // reverse chronological already reversed for rendering?
            const chronologicalSessions = [...completedSessions].sort(
              (a, b) => parseSessionDate(a.date) - parseSessionDate(b.date),
            );

            chronologicalSessions.forEach((session) => {
              const time =
                getMillis(session.createdAt) || parseSessionDate(session.date);
              if (time >= sixtyDaysAgo.getTime()) {
                const sLogs = allLogs.filter((l) => l.sessionId === session.id);
                const totalVol = sLogs.reduce(
                  (acc, log) => acc + calculateExerciseVolume(log),
                  0,
                );
                const dateStr = session.date
                  ? new Date(parseSessionDate(session.date)).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric" },
                    )
                  : "";
                if (dateStr) {
                  // Accumulate in case of multiple sessions a day
                  volumeByDate[dateStr] =
                    (volumeByDate[dateStr] || 0) + totalVol;
                }
              }
            });

            const volumeChartData = Object.keys(volumeByDate).map(
              (dateStr) => ({
                date: dateStr,
                volume: volumeByDate[dateStr],
              }),
            );

            const CustomVolumeTooltip = ({ active, payload, label }: any) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-[#0A2E46] border border-slate-200 dark:border-slate-700 p-3 rounded-lg shadow-xl min-w-30">
                    <p className="text-[11px] uppercase tracking-widest text-[#68717A] mb-1">
                      {label}
                    </p>
                    <p className="text-[#38BDF8] font-bold text-xl leading-none">
                      {payload[0].value.toLocaleString()}{" "}
                      <span className="text-xs">LBS</span>
                    </p>
                  </div>
                );
              }
              return null;
            };

            return (
              <Card className="rounded-[40px] border-2 shadow-xl overflow-hidden min-h-100">
                <CardHeader className="p-8 border-b bg-muted/20">
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                        Total Volume Progression
                      </CardTitle>
                      <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 mt-1">
                        60-Day Work Capacity Trend
                      </CardDescription>
                      <p className="text-slate-700 dark:text-slate-400 text-sm mt-1 italic">
                        Charts reflect currently loaded history. Load more
                        sessions to expand the timeline.
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[11px] font-bold bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/20"
                    >
                      Workload
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-8 h-87.5">
                  {volumeChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={volumeChartData}
                        margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="colorVolume"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#38BDF8"
                              stopOpacity={0.4}
                            />
                            <stop
                              offset="95%"
                              stopColor="#0A2E46"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="date"
                          stroke="#68717A"
                          tick={{
                            fill: "#68717A",
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                          tickMargin={10}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          stroke="#68717A"
                          tick={{ fill: "#68717A", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(val) =>
                            val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val
                          }
                        />
                        <RechartsTooltip content={<CustomVolumeTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="volume"
                          stroke="#38BDF8"
                          strokeWidth={4}
                          fillOpacity={1}
                          fill="url(#colorVolume)"
                          activeDot={{
                            r: 6,
                            fill: "#fff",
                            stroke: "#38BDF8",
                            strokeWidth: 2,
                          }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-30">
                      <TrendingUp className="w-12 h-12 text-[#68717A] mb-4" />
                      <p className="text-xs font-bold uppercase tracking-widest text-[#68717A]">
                        Not enough data in the last 60 days
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          <Card className="rounded-[40px] border-2 shadow-xl overflow-hidden min-h-100">
            <CardHeader className="p-8 border-b bg-muted/20">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                    Time Spent on Machines
                  </CardTitle>
                  <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 mt-1">
                    Efficiency & Pace Analytics
                  </CardDescription>
                </div>
                <div className="flex gap-4">
                  {(() => {
                    const completedSessions = sessions.filter(
                      (s) =>
                        s.status === "Completed" && s.startTime && s.endTime,
                    );
                    if (completedSessions.length === 0) return null;

                    const totalMins = completedSessions.reduce((acc, s) => {
                      return (
                        acc + (getMillis(s.endTime) - getMillis(s.startTime))
                      );
                    }, 0);
                    const avgMins = Math.round(
                      totalMins / completedSessions.length / 60000,
                    );

                    return (
                      <div className="text-right">
                        <p className="text-[11px] font-bold uppercase text-muted-foreground opacity-60">
                          Avg Session
                        </p>
                        <p className="text-sm font-bold italic text-primary">
                          {avgMins}m
                        </p>
                      </div>
                    );
                  })()}
                  <Badge
                    variant="outline"
                    className="text-[11px] font-bold bg-primary/10 text-primary border-primary/20"
                  >
                    Efficiency
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex flex-col md:flex-row h-150">
              {/* Sidebar: Session List */}
              <div className="w-full md:w-64 border-r overflow-y-auto bg-muted/5 divide-y">
                {sessions
                  .filter((s) => s.status === "Completed")
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedTimingSessionId(s.id!)}
                      className={`w-full p-4 text-left hover:bg-white transition-all group ${selectedTimingSessionId === s.id ? "bg-white shadow-sm ring-1 ring-primary/5" : ""}`}
                    >
                      <p
                        className={`text-[11px] flex justify-between items-center font-bold uppercase tracking-tighter ${selectedTimingSessionId === s.id ? "text-primary" : "text-muted-foreground"}`}
                      >
                        <span>{s.date}</span>
                        <span className="text-[11px] opacity-70 font-bold">
                          {s.legacy_filemaker_id ||
                          s.trainerId === "legacy-trainer" ||
                          s.trainerInitials === "Legacy" ||
                          s.trainerInitials === "Chart"
                            ? "Imported"
                            : s.startTime
                              ? new Date(
                                  s.startTime?.toMillis?.() || s.startTime,
                                ).toLocaleTimeString("en-US", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : ""}
                        </span>
                      </p>
                      <p className="text-xs font-bold truncate mt-1">
                        {s.routineName || "Session"}
                      </p>
                      {s.startTime && s.endTime && (
                        <p className="text-[11px] font-bold text-muted-foreground/60 uppercase mt-1">
                          {Math.round(
                            (getMillis(s.endTime) - getMillis(s.startTime)) /
                              60000,
                          )}{" "}
                          mins
                        </p>
                      )}
                    </button>
                  ))}
                {sessions.filter((s) => s.status === "Completed").length ===
                  0 && (
                  <div className="p-8 text-center opacity-20">
                    <Clock className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-[11px] font-medium uppercase tracking-wide opacity-70 leading-tight">
                      No data
                    </p>
                  </div>
                )}
              </div>

              {/* Main Content: Detailed Analysis */}
              <div className="flex-1 overflow-y-auto p-8">
                {(() => {
                  const focusSession =
                    sessions.find((s) => s.id === selectedTimingSessionId) ||
                    sessions[0];

                  if (!focusSession) {
                    return (
                      <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-4">
                        <Activity className="w-16 h-16" />
                        <p className="text-xs font-bold uppercase tracking-widest">
                          Select a session for analysis
                        </p>
                      </div>
                    );
                  }

                  const sessionLogs = allLogs
                    .filter((l) => l.sessionId === focusSession.id)
                    .sort((a, b) => {
                      const timeA =
                        a.updatedAt?.toMillis?.() ||
                        a.createdAt?.toMillis?.() ||
                        0;
                      const timeB =
                        b.updatedAt?.toMillis?.() ||
                        b.createdAt?.toMillis?.() ||
                        0;
                      return timeA - timeB;
                    });

                  const startTime =
                    focusSession.startTime?.toMillis?.() ||
                    focusSession.createdAt?.toMillis?.();

                  const SETUP_BUFFER_SECONDS = 45;

                  const sStartTime =
                    focusSession.startTime?.toMillis?.() ||
                    focusSession.createdAt?.toMillis?.() ||
                    0;

                  const tutData: any[] = [];
                  sessionLogs.forEach((log, idx) => {
                    const lTimeMs =
                      log.updatedAt?.toMillis?.() ||
                      log.createdAt?.toMillis?.() ||
                      0;
                    const pTimeMs =
                      idx === 0
                        ? sStartTime
                        : sessionLogs[idx - 1].updatedAt?.toMillis?.() ||
                          sessionLogs[idx - 1].createdAt?.toMillis?.() ||
                          0;

                    let grossTimeSeconds = 0;
                    if (lTimeMs > 0 && pTimeMs > 0 && lTimeMs > pTimeMs) {
                      grossTimeSeconds = Math.round((lTimeMs - pTimeMs) / 1000);
                    }

                    if (grossTimeSeconds === 0 && log.timeSpent) {
                      const parsed = parseInt(log.timeSpent, 10);
                      if (!isNaN(parsed)) grossTimeSeconds = parsed;
                    }

                    const netActiveTime = Math.max(
                      0,
                      grossTimeSeconds - SETUP_BUFFER_SECONDS,
                    );
                    const reps = log.reps
                      ? parseInt(log.reps.toString(), 10)
                      : 0;
                    let estimatedTutPerRep = 0;

                    const isStatic =
                      log.isStaticHold ||
                      log.isTSC ||
                      (log.seconds &&
                        (!log.reps || parseInt(log.reps.toString()) === 0));

                    if (isStatic) {
                      estimatedTutPerRep =
                        reps > 0 ? netActiveTime / reps : netActiveTime;
                    } else {
                      if (reps > 0) {
                        estimatedTutPerRep = netActiveTime / reps;
                      }
                    }

                    const machine = machines.find(
                      (m) => m.id === log.machineId,
                    );

                    tutData.push({
                      id: log.id,
                      machineId: log.machineId,
                      machineName: machine?.name || "Unknown",
                      grossTimeSeconds,
                      netActiveTime,
                      reps,
                      isStatic,
                      estimatedTutPerRep:
                        Math.round(estimatedTutPerRep * 10) / 10,
                    });
                  });

                  // Format as MM:SS helper for tooltip
                  const formatMMSS = (totalSeconds: number) => {
                    if (isNaN(totalSeconds) || totalSeconds < 0) return "0:00";
                    const mins = Math.floor(totalSeconds / 60);
                    const secs = Math.floor(totalSeconds % 60);
                    return `${mins}:${secs.toString().padStart(2, "0")}`;
                  };

                  const CustomTutTooltip = ({ active, payload }: any) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-[#0A2E46] border border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-xl">
                          <p className="font-bold uppercase text-sm mb-2">
                            {data.machineName}
                          </p>
                          <div className="space-y-1">
                            <div className="flex justify-between gap-6">
                              <span className="text-slate-800 dark:text-slate-400 text-[11px] font-medium uppercase">
                                Estimated TUT/Rep:
                              </span>
                              <span className="text-[#38BDF8] text-sm font-bold">
                                {data.estimatedTutPerRep}s
                              </span>
                            </div>
                            <div className="flex justify-between gap-6">
                              <span className="text-slate-800 dark:text-slate-400 text-[11px] font-medium uppercase">
                                Reps:
                              </span>
                              <span className="text-xs font-bold">
                                {data.isStatic ? "Static Hold" : data.reps}
                              </span>
                            </div>
                            <div className="flex justify-between gap-6">
                              <span className="text-slate-800 dark:text-slate-400 text-[11px] font-medium uppercase">
                                Gross Time:
                              </span>
                              <span className="text-xs font-bold">
                                {formatMMSS(data.grossTimeSeconds)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-6">
                              <span className="text-slate-800 dark:text-slate-400 text-[11px] font-medium uppercase">
                                Net Active:
                              </span>
                              <span className="text-xs font-bold">
                                {formatMMSS(data.netActiveTime)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  };

                  return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 h-full flex flex-col">
                      <div className="flex items-center justify-between border-b pb-4 shrink-0">
                        <div>
                          <h4 className="text-lg font-bold uppercase italic text-primary">
                            {focusSession.date}
                          </h4>
                          <p className="text-[11px] font-bold text-muted-foreground uppercase">
                            {focusSession.routineName || "Free Protocol"}
                          </p>
                        </div>
                        {focusSession.startTime && focusSession.endTime && (
                          <div className="text-right">
                            <p className="text-xl font-bold italic text-foreground leading-none">
                              {Math.round(
                                (getMillis(focusSession.endTime) -
                                  getMillis(focusSession.startTime)) /
                                  60000,
                              )}
                              m
                            </p>
                            <p className="text-[11px] font-bold text-muted-foreground uppercase opacity-60">
                              Total Duration
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-h-100">
                        {tutData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={tutData}
                              margin={{
                                top: 20,
                                right: 30,
                                left: -20,
                                bottom: 40,
                              }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#334155"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="machineName"
                                stroke="#64748b"
                                tick={{
                                  fill: "#64748b",
                                  fontSize: 9,
                                  fontWeight: "bold",
                                }}
                                interval={0}
                                angle={-45}
                                textAnchor="end"
                              />
                              <YAxis
                                stroke="#64748b"
                                tick={{
                                  fill: "#64748b",
                                  fontSize: 10,
                                  fontWeight: "bold",
                                }}
                                tickFormatter={(val) => `${val}s`}
                              />
                              <RechartsTooltip
                                content={<CustomTutTooltip />}
                                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                              />
                              <ReferenceLine
                                y={12}
                                stroke="#f43f5e"
                                strokeDasharray="3 3"
                                strokeWidth={2}
                                label={{
                                  position: "top",
                                  value: "12s (IDEAL TUT)",
                                  fill: "#f43f5e",
                                  fontSize: 10,
                                  fontWeight: "bold",
                                }}
                              />
                              <Bar
                                dataKey="estimatedTutPerRep"
                                fill="#38BDF8"
                                radius={[4, 4, 0, 0]}
                                maxBarSize={40}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center opacity-30">
                            <Activity className="w-10 h-10 mx-auto mb-3" />
                            <p className="text-xs font-bold uppercase tracking-widest">
                              No timing logs for this session
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </TabsContent>{" "}
        <TabsContent value="details_disabled" className="hidden">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-6">
            {/* 1. The "Why" (Goals & Motivation) */}
            <Card className="rounded-[40px] shadow-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
              <CardHeader className="p-8 border-b border-slate-200 dark:border-slate-700">
                <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                  The 'Why' (Goals & Motivation)
                </CardTitle>
                <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-[#38BDF8]">
                  Discovery & Intent Path
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="space-y-2">
                  <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                    Discovery Notes (Stage 1)
                  </Label>
                  <Textarea
                    value={infoForm.discoveryNotes || ""}
                    onChange={(e) =>
                      setInfoForm((f) => ({
                        ...f,
                        discoveryNotes: e.target.value,
                      }))
                    }
                    className="min-h-25 rounded-2xl font-bold p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus-visible:ring-[#38BDF8] resize-none"
                    placeholder="Context from initial contact..."
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                    Primary Training Goals & Deep Intent
                  </Label>
                  <Textarea
                    value={infoForm.globalNotes || ""}
                    onChange={(e) =>
                      setInfoForm((f) => ({
                        ...f,
                        globalNotes: e.target.value,
                      }))
                    }
                    className="min-h-35 rounded-2xl font-bold p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus-visible:ring-[#38BDF8]"
                    placeholder="What are we really solving for? (e.g. 'I want to be able to pick up my grandkids without back pain')..."
                  />
                </div>
              </CardContent>
            </Card>

            {/* 2. Lifestyle & Environment */}
            <Card className="rounded-[40px] shadow-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
              <CardHeader className="p-8 border-b border-slate-200 dark:border-slate-700">
                <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                  Lifestyle & Environment
                </CardTitle>
                <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-[#38BDF8]">
                  External Stressors & Physical Context
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                      Occupation
                    </Label>
                    <OccupationSelect
                      value={infoForm.occupation || ""}
                      onChange={(v) =>
                        setInfoForm((f) => ({ ...f, occupation: v }))
                      }
                      disabled={infoForm.isRetired}
                    />
                  </div>
                  <div className="space-y-2 flex flex-col justify-center">
                    <div className="flex items-center gap-4 mt-2">
                      <Switch
                        checked={infoForm.isRetired}
                        onCheckedChange={(v) =>
                          setInfoForm((f) => ({ ...f, isRetired: v }))
                        }
                        className="data-[state=checked]:bg-[#38BDF8]"
                      />
                      <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-700 dark:text-slate-300">
                        Retired
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                    Daily Activity Level
                  </Label>
                  <Select
                    value={infoForm.activityLevel || ""}
                    onValueChange={(v) =>
                      setInfoForm((f) => ({ ...f, activityLevel: v as any }))
                    }
                  >
                    <SelectTrigger className="w-full h-12 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 font-bold rounded-2xl focus-visible:ring-[#38BDF8]">
                      <SelectValue placeholder="Select an option…" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl">
                      <SelectItem value="Sedentary">Sedentary</SelectItem>
                      <SelectItem value="Light">Light</SelectItem>
                      <SelectItem value="Moderate">Moderate</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Manual Labor">Manual Labor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                    Systemic Recovery (Sleep/Stress)
                  </Label>
                  <Select
                    value={infoForm.recoveryMetric || ""}
                    onValueChange={(v) =>
                      setInfoForm((f) => ({ ...f, recoveryMetric: v as any }))
                    }
                  >
                    <SelectTrigger className="w-full h-12 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 font-bold rounded-2xl focus-visible:ring-[#38BDF8]">
                      <SelectValue placeholder="Select an option…" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl">
                      <SelectItem value="Poor">Poor</SelectItem>
                      <SelectItem value="Average">Average</SelectItem>
                      <SelectItem value="Optimal">Optimal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                    Experience Level
                  </Label>
                  <Select
                    value={infoForm.trainingPedigree || ""}
                    onValueChange={(v) =>
                      setInfoForm((f) => ({ ...f, trainingPedigree: v as any }))
                    }
                  >
                    <SelectTrigger className="w-full h-12 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 font-bold rounded-2xl focus-visible:ring-[#38BDF8]">
                      <SelectValue placeholder="Select an option…" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl">
                      <SelectItem value="Novice">
                        Novice (No lifting experience)
                      </SelectItem>
                      <SelectItem value="Intermediate">
                        Intermediate (Standard gym experience)
                      </SelectItem>
                      <SelectItem value="Advanced">
                        Advanced (Extensive free weights/machines)
                      </SelectItem>
                      <SelectItem value="Protocol Veteran">
                        Protocol Veteran (Prior high-intensity experience)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* 3. The Clinical Baseline (Medical) */}
            <Card className="rounded-[40px] shadow-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 lg:col-span-2">
              <CardHeader className="p-8 border-b border-slate-200 dark:border-slate-700">
                <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                  The Clinical Baseline (Medical)
                </CardTitle>
                <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-[#38BDF8]">
                  Orthopedic & Safety Flags
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8">
                {(() => {
                  // Group clinical flags by category
                  const groupedFlags = CLINICAL_FLAGS_MATRIX.reduce(
                    (acc, flag) => {
                      if (!acc[flag.category]) acc[flag.category] = [];
                      acc[flag.category].push(flag);
                      return acc;
                    },
                    {} as Record<string, typeof CLINICAL_FLAGS_MATRIX>,
                  );

                  return (
                    <div className="space-y-6">
                      {infoForm.clinicalFlags &&
                        infoForm.clinicalFlags.length > 0 && (
                          <div className="w-full flex flex-col gap-2 mb-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                            <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400">
                              Active Health Flags
                            </Label>
                            <div className="flex flex-wrap gap-2">
                              {infoForm.clinicalFlags.map((flagId) => {
                                const flag = CLINICAL_FLAGS_MATRIX.find(
                                  (f) => f.id === flagId,
                                );
                                if (!flag) return null;

                                const bgColors = {
                                  "Absolute Contraindication":
                                    "bg-rose-950/50 border-rose-600/50 text-rose-200",
                                  "High Risk":
                                    "bg-amber-950/50 border-amber-500/50 text-amber-200",
                                  "Moderate / Needs Modification":
                                    "bg-blue-950/50 border-blue-500/50 text-blue-200",
                                };

                                return (
                                  <div
                                    key={flagId}
                                    className={`px-3 py-1.5 rounded-lg border flex items-center text-xs font-bold leading-none ${bgColors[flag.category as keyof typeof bgColors] || "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-200"}`}
                                  >
                                    <AlertCircle className="w-3 h-3 mr-1.5 opacity-70" />
                                    {flag.conditionName}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                            Select Pertinent Health Flags
                          </Label>
                          <div className="w-full space-y-2">
                            {Object.entries(groupedFlags).map(
                              ([category, flags]) => (
                                <div key={category}>
                                  <h4 className="text-sm font-bold text-slate-300 mb-3 mt-6 first:mt-0">
                                    {category}
                                  </h4>
                                  <div className="flex flex-wrap gap-2">
                                    {(flags as ClinicalSafetyFlag[]).map(
                                      (flag) => {
                                        const isChecked =
                                          infoForm.clinicalFlags?.includes(
                                            flag.id,
                                          ) || false;

                                        const unselectedStyles =
                                          "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:bg-slate-800 transition-colors px-3 py-1.5 rounded-full text-xs font-medium";

                                        let selectedStyles = "";
                                        if (
                                          flag.severity ===
                                          "Absolute Contraindication"
                                        ) {
                                          selectedStyles =
                                            "bg-rose-950/50 border border-rose-500 text-rose-400 px-3 py-1.5 rounded-full text-xs font-medium shadow-[0_0_10px_rgba(244,63,94,0.1)]";
                                        } else if (
                                          flag.severity === "High Risk"
                                        ) {
                                          selectedStyles =
                                            "bg-amber-950/50 border border-amber-500 text-amber-400 px-3 py-1.5 rounded-full text-xs font-medium shadow-[0_0_10px_rgba(245,158,11,0.1)]";
                                        } else {
                                          selectedStyles =
                                            "bg-blue-950/50 border border-blue-500 text-blue-400 px-3 py-1.5 rounded-full text-xs font-medium shadow-[0_0_10px_rgba(59,130,246,0.1)]";
                                        }

                                        return (
                                          <button
                                            key={flag.id}
                                            onClick={() => {
                                              const current =
                                                infoForm.clinicalFlags || [];
                                              if (!isChecked) {
                                                setInfoForm((f) => ({
                                                  ...f,
                                                  clinicalFlags: [
                                                    ...current,
                                                    flag.id,
                                                  ],
                                                }));
                                              } else {
                                                setInfoForm((f) => ({
                                                  ...f,
                                                  clinicalFlags: current.filter(
                                                    (a) => a !== flag.id,
                                                  ),
                                                }));
                                              }
                                            }}
                                            className={
                                              isChecked
                                                ? selectedStyles
                                                : unselectedStyles
                                            }
                                          >
                                            {flag.conditionName}
                                          </button>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                              Ailments, Injuries & Limitations
                            </Label>
                            <Textarea
                              value={infoForm.clinicalNotes || ""}
                              onChange={(e) =>
                                setInfoForm((f) => ({
                                  ...f,
                                  clinicalNotes: e.target.value,
                                }))
                              }
                              className="min-h-50 rounded-2xl font-bold p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus-visible:ring-[#38BDF8] transition-all"
                              placeholder="Detail any orthopedic history or clinical considerations..."
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* 4. Client Information */}
            <Card className="rounded-[40px] shadow-sm bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 flex flex-col h-full">
              <CardHeader className="p-8 border-b border-slate-200 dark:border-slate-800">
                <CardTitle className="text-2xl font-bold uppercase tracking-tighter text-slate-900 dark:text-white">
                  Client Information
                </CardTitle>
                <CardDescription className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Identity & Membership Overview
                </CardDescription>
              </CardHeader>
              <CardContent className="p-8 flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Full Name
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        value={infoForm.firstName || ""}
                        onChange={(e) =>
                          setInfoForm((f) => ({
                            ...f,
                            firstName: e.target.value,
                          }))
                        }
                        placeholder="First"
                        className="h-14 md:h-16 text-lg sm:text-xl rounded-2xl font-bold px-5 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-[#F06C22] shadow-sm text-slate-900 dark:text-slate-100"
                      />
                      <Input
                        value={infoForm.lastName || ""}
                        onChange={(e) =>
                          setInfoForm((f) => ({
                            ...f,
                            lastName: e.target.value,
                          }))
                        }
                        placeholder="Last"
                        className="h-14 md:h-16 text-lg sm:text-xl rounded-2xl font-bold px-5 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-[#F06C22] shadow-sm text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Email
                    </Label>
                    <Input
                      value={infoForm.email || ""}
                      onChange={(e) =>
                        setInfoForm((f) => ({ ...f, email: e.target.value }))
                      }
                      className="h-14 md:h-16 text-lg sm:text-xl rounded-2xl font-bold px-5 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-[#F06C22] shadow-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Age
                    </Label>
                    <Input
                      type="number"
                      value={infoForm.age ?? ""}
                      onChange={(e) =>
                        setInfoForm((f) => ({
                          ...f,
                          age: e.target.value ? parseInt(e.target.value) : null,
                        }))
                      }
                      className="h-14 md:h-16 text-lg sm:text-xl rounded-2xl font-bold px-5 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-[#F06C22] shadow-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Package Tier
                    </Label>
                    <Select
                      value={infoForm.packageTier || ""}
                      onValueChange={(v: any) =>
                        setInfoForm((f) => ({ ...f, packageTier: v }))
                      }
                    >
                      <SelectTrigger className="h-14 md:h-16 text-lg sm:text-xl rounded-2xl font-bold px-5 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-[#F06C22] shadow-sm text-slate-900 dark:text-slate-100 data-placeholder:text-slate-400">
                        <SelectValue placeholder="Select an option…" />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold p-2">
                        <SelectItem
                          value="None"
                          className="h-12 text-sm sm:text-base"
                        >
                          None / Trial
                        </SelectItem>
                        <SelectItem
                          value="6-Month"
                          className="h-12 text-sm sm:text-base"
                        >
                          6-Month
                        </SelectItem>
                        <SelectItem
                          value="12-Month"
                          className="h-12 text-sm sm:text-base"
                        >
                          12-Month
                        </SelectItem>
                        <SelectItem
                          value="18-Month"
                          className="h-12 text-sm sm:text-base"
                        >
                          18-Month VIP
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Start Date
                    </Label>
                    <Input
                      type="text"
                      placeholder="MM/DD/YYYY"
                      value={infoForm.firstSessionDateRaw || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const numbersOnly = val.replace(/\D/g, "");
                        let formatted = numbersOnly;
                        if (numbersOnly.length > 2 && numbersOnly.length <= 4) {
                          formatted = `${numbersOnly.slice(0, 2)}/${numbersOnly.slice(2)}`;
                        } else if (numbersOnly.length > 4) {
                          formatted = `${numbersOnly.slice(0, 2)}/${numbersOnly.slice(2, 4)}/${numbersOnly.slice(4, 8)}`;
                        }

                        setInfoForm((f) => ({
                          ...f,
                          firstSessionDateRaw: formatted,
                        }));

                        if (numbersOnly.length === 8) {
                          const m = parseInt(numbersOnly.slice(0, 2), 10);
                          const d_val = parseInt(numbersOnly.slice(2, 4), 10);
                          const y = parseInt(numbersOnly.slice(4, 8), 10);
                          if (
                            m >= 1 &&
                            m <= 12 &&
                            d_val >= 1 &&
                            d_val <= 31 &&
                            y >= 1900
                          ) {
                            const selectedDate = new Date(y, m - 1, d_val);
                            const timestamp = Timestamp.fromDate(selectedDate);
                            setInfoForm((f) => ({
                              ...f,
                              firstSessionDate: timestamp,
                              firstSessionDateRaw: formatted,
                            }));
                            handleStartDateChange(`${formatted}`);
                          }
                        } else if (numbersOnly.length === 0) {
                          setInfoForm((f) => ({
                            ...f,
                            firstSessionDate: null,
                            firstSessionDateRaw: "",
                          }));
                        }
                      }}
                      className="h-14 md:h-16 text-lg sm:text-xl rounded-2xl font-bold px-5 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-[#F06C22] shadow-sm text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1 space-y-6">
              <Card className="rounded-[40px] shadow-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 overflow-hidden">
                <CardHeader className="p-8 border-b border-slate-200 dark:border-slate-700 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                      Reminders
                    </CardTitle>
                    <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-[#38BDF8]">
                      Alerts & Follow-ups
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm">
                    <div className="grid grid-cols-1 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                          Event Type
                        </Label>
                        <Select
                          value={newEventForm.type}
                          onValueChange={(v: any) =>
                            setNewEventForm({ ...newEventForm, type: v })
                          }
                        >
                          <SelectTrigger className="w-full h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 font-bold rounded-2xl focus-visible:ring-[#38BDF8]">
                            <SelectValue placeholder="Select Type..." />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl">
                            <SelectItem value="Progress Report">
                              Progress Report
                            </SelectItem>
                            <SelectItem value="InBody Scan">
                              InBody Scan
                            </SelectItem>
                            <SelectItem value="Routine Change">
                              Routine Change
                            </SelectItem>
                            <SelectItem value="Vacation">Vacation</SelectItem>
                            <SelectItem value="Birthday/Anniversary">
                              Birthday/Anniversary
                            </SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                          Date
                        </Label>
                        <Input
                          type="date"
                          value={newEventForm.date}
                          onChange={(e) =>
                            setNewEventForm((f) => ({
                              ...f,
                              date: e.target.value,
                            }))
                          }
                          className="h-12 rounded-2xl font-bold px-4 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-[#38BDF8]"
                        />
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                        Event Title
                      </Label>
                      <Input
                        value={newEventForm.title}
                        onChange={(e) =>
                          setNewEventForm((f) => ({
                            ...f,
                            title: e.target.value,
                          }))
                        }
                        placeholder="Brief description..."
                        className="h-12 rounded-2xl font-bold px-4 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-[#38BDF8]"
                      />
                    </div>
                    <div className="space-y-2 mb-6">
                      <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1">
                        Notes
                      </Label>
                      <Textarea
                        value={newEventForm.notes}
                        onChange={(e) =>
                          setNewEventForm((f) => ({
                            ...f,
                            notes: e.target.value,
                          }))
                        }
                        className="min-h-20 rounded-3xl font-medium p-4 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-[#38BDF8] resize-none"
                        placeholder="Optional details..."
                      />
                    </div>
                    <Button
                      onClick={handleAddEvent}
                      disabled={
                        !newEventForm.title ||
                        !newEventForm.date ||
                        isSavingEvent
                      }
                      className="w-full bg-[#38BDF8] hover:bg-[#0ea5e9] font-bold uppercase tracking-widest text-xs h-12 rounded-full transition-all"
                    >
                      {isSavingEvent ? "Adding..." : "Add Event"}
                    </Button>
                  </div>

                  {client?.events && client.events.length > 0 ? (
                    <div className="space-y-3 mt-8">
                      <h4 className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400 ml-1 mb-4">
                        Scheduled Events
                      </h4>
                      {client.events
                        .sort(
                          (a, b) =>
                            new Date(b.date).getTime() -
                            new Date(a.date).getTime(),
                        )
                        .map((event) => (
                          <div
                            key={event.id}
                            className="flex flex-col gap-2 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl group transition-all hover:bg-slate-50 shadow-sm"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex flex-col">
                                <span
                                  className={cn(
                                    "text-[11px] font-bold uppercase tracking-widest mb-1",
                                    event.priority === "High"
                                      ? "text-red-400"
                                      : event.priority === "Medium"
                                        ? "text-amber-400"
                                        : "text-slate-600 dark:text-slate-400",
                                  )}
                                >
                                  {event.type} • {event.priority} Priority
                                </span>
                                <span className="font-bold">{event.title}</span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[11px] font-bold tracking-widest uppercase text-slate-800 dark:text-slate-400 mb-1">
                                  {new Date(
                                    parseSessionDate(event.date),
                                  ).toLocaleDateString()}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteEvent(event.id)}
                                  className="h-8 w-8 p-0 text-red-500/50 hover:text-red-500 hover:bg-red-500/10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                            {event.notes && (
                              <p className="text-xs text-slate-500 dark:text-slate-600 mt-1 font-medium bg-white dark:bg-slate-900 p-3 flex rounded-xl">
                                {event.notes}
                              </p>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="rounded-2xl shadow-sm bg-surface-1 border border-div-d">
                <CardHeader className="p-8 border-b border-div-d">
                  <CardTitle className="text-xl font-bold uppercase italic tracking-tighter text-white">
                    Retention Status
                  </CardTitle>
                  <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-cyan">
                    MIA Tracking & Overrides
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between bg-surface-2 p-4 rounded-xl border border-div-d">
                      <div>
                        <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-ink-d2">
                          Exclude from MIA Tracking
                        </Label>
                        <p className="text-[11px] font-bold opacity-40 uppercase tracking-tighter mt-0.5 text-ink-d3">
                          Temporarily pause retention alerts
                        </p>
                      </div>
                      <Switch
                        checked={
                          infoForm.retentionMeta?.excludedFromMIA || false
                        }
                        onCheckedChange={(v) => {
                          setInfoForm((f) => ({
                            ...f,
                            retentionMeta: {
                              ...f.retentionMeta,
                              excludedFromMIA: v,
                              excludedBy: v ? authTrainer?.fullName : undefined,
                            },
                          }));
                        }}
                        className="data-[state=checked]:bg-cyan"
                      />
                    </div>

                    {infoForm.retentionMeta?.excludedFromMIA && (
                      <div className="bg-surface-2 p-4 rounded-xl border border-div-d space-y-4">
                        <div className="flex flex-col gap-2">
                          <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-ink-d2">
                            Reason
                          </Label>
                          <Select
                            value={infoForm.retentionMeta.excludedReason || ""}
                            onValueChange={(val) =>
                              setInfoForm((f) => ({
                                ...f,
                                retentionMeta: {
                                  ...f.retentionMeta,
                                  excludedReason: val,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="w-full bg-surface-1 border border-div-d rounded-xl min-h-11 text-white focus:ring-2 focus:ring-cyan focus:ring-offset-2 focus:ring-offset-bg-dark">
                              <SelectValue placeholder="Select reason..." />
                            </SelectTrigger>
                            <SelectContent className="bg-surface-2 text-white border-div-d">
                              <SelectItem value="Vacation">Vacation</SelectItem>
                              <SelectItem value="Medical / Injury">
                                Medical / Injury
                              </SelectItem>
                              <SelectItem value="Snowbird / Seasonal Relocation">
                                Snowbird / Seasonal Relocation
                              </SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-2">
                          <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-ink-d2">
                            Auto-Resume Date
                          </Label>
                          <input
                            type="date"
                            value={
                              infoForm.retentionMeta.autoIncludeAfter
                                ? new Date(
                                    infoForm.retentionMeta.autoIncludeAfter,
                                  )
                                    .toISOString()
                                    .split("T")[0]
                                : ""
                            }
                            onChange={(e) =>
                              setInfoForm((f) => ({
                                ...f,
                                retentionMeta: {
                                  ...f.retentionMeta,
                                  autoIncludeAfter: e.target.value
                                    ? new Date(e.target.value).toISOString()
                                    : undefined,
                                },
                              }))
                            }
                            className="flex min-h-11 w-full rounded-xl border border-div-d bg-surface-1 px-3 py-2 text-[14px] text-white focus:outline-none focus:ring-2 focus:ring-cyan focus:ring-offset-2 focus:ring-offset-bg-dark"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[40px] shadow-sm bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardHeader className="p-8 border-b border-slate-200 dark:border-slate-800">
                  <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                    Account Actions
                  </CardTitle>
                  <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-[#38BDF8]">
                    Protocol & Membership Management
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <div>
                      <Label className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-slate-800 dark:text-slate-400">
                        Active Account
                      </Label>
                      <p className="text-[11px] font-bold opacity-40 uppercase tracking-tighter mt-0.5 text-slate-300">
                        Toggle client visibility in lists
                      </p>
                    </div>
                    <Switch
                      checked={infoForm.isActive}
                      onCheckedChange={(v) =>
                        setInfoForm((f) => ({ ...f, isActive: v }))
                      }
                      className="data-[state=checked]:bg-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <Button
                      onClick={() => setView("chart-importer" as any)}
                      className="w-full bg-[#0ea5e9]/10 hover:bg-[#0ea5e9]/20 text-[#38BDF8] border border-[#38BDF8]/30 rounded-2xl font-bold uppercase italic tracking-widest h-12 shadow-sm transition-all"
                    >
                      <Maximize className="w-4 h-4 mr-2" />
                      Open Migration Hub
                    </Button>

                    <Button
                      onClick={() =>
                        setView("workouts", { isIntroSession: true })
                      }
                      className="w-full bg-[#115E8D] hover:bg-[#115E8D]/90 rounded-2xl font-bold uppercase italic tracking-widest h-12 shadow-md shadow-[#115E8D]/20"
                    >
                      Start Introductory Session
                    </Button>

                    <Button
                      disabled={isSavingInfo}
                      onClick={handleSaveInfo}
                      className="w-full h-12 rounded-full bg-[#F06C22] hover:bg-[#ea580c] font-bold uppercase italic text-xs tracking-widest shadow-[0_0_20px_rgba(240,108,34,0.3)] transition-all"
                    >
                      {isSavingInfo ? "Processing..." : "Save All Changes"}
                    </Button>

                    <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
                      <Button
                        variant="outline"
                        className="w-full h-10 rounded-full border-red-500/20 text-red-500 hover:bg-red-500/10 hover:text-red-400 font-bold uppercase tracking-widest text-[11px] transition-all bg-transparent shadow-none"
                        onClick={() => setIsDeleting(true)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Delete Member Profile
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {checkIsOwner(authTrainer) && (
                <Card className="rounded-[40px] shadow-sm bg-amber-500/5 border-amber-500/10">
                  <CardHeader className="p-8 border-b border-amber-500/10 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-xl font-bold uppercase italic tracking-tighter">
                        Debug Tools
                      </CardTitle>
                      <CardDescription className="text-[11px] font-medium uppercase tracking-wide opacity-70 text-amber-500/80">
                        Administrative Utilities
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8 space-y-4">
                    <Button
                      onClick={() => setShowMockConfirm(true)}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-black rounded-2xl font-bold uppercase italic tracking-widest h-12 shadow-sm transition-all"
                    >
                      <Database className="w-4 h-4 mr-2" />
                      Provision Mock Client Data
                    </Button>
                    <p className="text-[11px] text-center text-amber-500/40 font-bold uppercase tracking-widest">
                      Creates a new test entity with full history
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {showFullChart &&
        clientId &&
        createPortal(
          <WorkoutChartGrid
            clientId={clientId}
            clients={clients}
            machines={machines}
            routines={routines}
            onBack={() => setShowFullChart(false)}
            user={user}
            preloadedSessions={sessions}
            preloadedLogs={allLogs}
            onLoadMoreHistory={handleLoadMoreHistory}
            studios={studios}
            activeStudioId={activeStudioId}
          />,
          document.body,
        )}

      <Dialog open={isDeleting} onOpenChange={setIsDeleting}>
        <DialogContent
          showCloseButton={false}
          className="rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-2xl p-0 overflow-hidden max-w-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
        >
          <div className="bg-red-600 p-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold uppercase italic tracking-tighter leading-none">
                Confirm Deletion
              </h2>
              <p className="text-[11px] font-medium uppercase tracking-wide opacity-70 mt-2">
                This action is permanent
              </p>
            </div>
          </div>
          <div className="p-8 space-y-6 text-center bg-white dark:bg-slate-900">
            <p className="text-sm font-medium text-muted-foreground leading-relaxed">
              Are you absolutely sure you want to delete{" "}
              <span className="font-bold text-foreground">
                {" "}
                {client.firstName} {client.lastName}'s
              </span>{" "}
              profile? All historical session data and machine settings will be
              lost.
            </p>
            <div className="flex flex-col gap-3">
              <Button
                variant="destructive"
                className="h-14 rounded-full font-bold uppercase italic tracking-widest text-xs shadow-xl shadow-red-200"
                onClick={() => {
                  if (client.id) onDelete(client.id);
                  setIsDeleting(false);
                }}
              >
                Delete Everything
              </Button>
              <Button
                variant="ghost"
                className="h-12 rounded-full font-bold text-muted-foreground"
                onClick={() => setIsDeleting(false)}
              >
                Go Back
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MachineSettingsDashboardModal
        editingSettings={editingSettings}
        setEditingSettings={setEditingSettings}
        machines={machines}
        exerciseLogs={allLogs}
        sessions={sessions}
        isSaving={isSavingSettings}
        onSave={handleUpdateMachineSettings}
        studios={studios}
        activeStudioId={activeStudioId}
      />

      <Dialog
        open={isEditingSessionCount}
        onOpenChange={setIsEditingSessionCount}
      >
        <DialogContent
          showCloseButton={false}
          className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 sm:max-w-xs text-slate-900 dark:text-white"
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold uppercase italic tracking-tighter">
              Edit Session Count
            </DialogTitle>
            <DialogDescription className="text-xs uppercase tracking-widest text-[#38BDF8] font-bold">
              Adjust {client.firstName}'s total sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">
                Total Sessions completed
              </Label>
              <Input
                type="number"
                value={sessionCountInput}
                onChange={(e) => setSessionCountInput(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 font-bold text-lg h-12 focus-visible:ring-[#38BDF8]"
                placeholder="0"
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setIsEditingSessionCount(false)}
                className="flex-1 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl font-bold uppercase tracking-widest text-[11px]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveSessionCount}
                className="flex-2 bg-[#38BDF8] hover:bg-[#0284c7] rounded-full font-bold uppercase tracking-widest text-[11px]"
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <StrongConfirmationModal
        isOpen={!!reportToDelete}
        title="Delete Progress Report"
        description="Are you sure you want to delete this progress report? This action is permanent and cannot be undone."
        confirmationPhrase="DELETE REPORT"
        onConfirm={performReportDelete}
        onCancel={() => setReportToDelete(null)}
      />

      <StrongConfirmationModal
        isOpen={showMockConfirm}
        title="Provision Mock Client Data"
        description="Are you sure you want to generate a new mock client with 60 days of historical workout data? This will create a temporary member record for validation."
        confirmationPhrase="GENERATE MOCK"
        onConfirm={performMockGeneration}
        onCancel={() => setShowMockConfirm(false)}
      />
    </motion.div>
  );
}
