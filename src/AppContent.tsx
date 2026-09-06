/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import {
  Users,
  Plus,
  AlertCircle,
  AlertTriangle,
  LogOut,
  UserCircle,
  Dumbbell,
  ClipboardList,
  ChevronRight,
  MessageSquare,
  StickyNote,
  Settings,
  GripVertical,
  LayoutDashboard,
  Play,
  Calendar,
  Lock,
  Edit3,
  TrendingUp,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  Network,
  Building2,
  Search,
  RefreshCw,
  X,
  ListChecks,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  getDocs,
  getDoc,
  Timestamp,
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  OAuthProvider,
  User as FirebaseUser,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import { db, auth } from "./firebase";
import {
  Trainer,
  TrainerAvailability,
  Client,
  View,
  Machine,
  TrainerFocus,
  Studio,
  FranchiseNetwork,
} from "./types";
import { OperationType, handleFirestoreError } from "./lib/firestore-errors";
import { isSessionValid } from "./lib/utils";
import { useToast } from "./contexts/ToastContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import AccessRequestView from "./components/AccessRequestView";
// Lazy-loaded: downloaded on first visit to this view, not at app start.
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const TrainerSettingsView = lazy(() =>
  import("./features/settings").then((m) => ({ default: m.TrainerSettingsView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ClientProfileView = lazy(() =>
  import("./components/ClientProfileView").then((m) => ({ default: m.ClientProfileView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const CalendarView = lazy(() =>
  import("./components/CalendarView").then((m) => ({ default: m.CalendarView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const LegacyChartImporter = lazy(() =>
  import("./components/LegacyChartImporter").then((m) => ({ default: m.LegacyChartImporter })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const MachineLeaderboardDashboard = lazy(() =>
  import("./components/MachineLeaderboardDashboard").then((m) => ({ default: m.MachineLeaderboardDashboard })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ProfilesView = lazy(() =>
  import("./components/ProfilesView").then((m) => ({ default: m.ProfilesView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ClientDirectoryView = lazy(() =>
  import("./components/ClientDirectoryView").then((m) => ({ default: m.ClientDirectoryView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const TrainerProfileView = lazy(() =>
  import("./features/trainer-profile").then((m) => ({ default: m.TrainerProfileView })),
);
import { StudioSelectionView } from "./components/StudioSelectionView";
// Lazy-loaded: downloaded on first visit to this view, not at app start.

import { AppHeader } from "./components/AppHeader";
import { useTheme } from "./components/ThemeProvider";
import { ClientsView } from "./components/ClientsView";
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ClientHistoryView = lazy(() =>
  import("./components/ClientHistoryView").then((m) => ({ default: m.ClientHistoryView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const MachinesView = lazy(() =>
  import("./components/MachinesView").then((m) => ({ default: m.MachinesView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const WorkoutTrackerView = lazy(() =>
  import("./components/WorkoutTrackerView").then((m) => ({ default: m.WorkoutTrackerView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ConsultationWizard = lazy(() =>
  import("./components/ConsultationWizard").then((m) => ({ default: m.ConsultationWizard })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const AdminDashboardView = lazy(() =>
  import("./components/AdminDashboardView").then((m) => ({ default: m.AdminDashboardView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const FranchiseDashboardView = lazy(() =>
  import("./components/FranchiseDashboardView").then((m) => ({ default: m.FranchiseDashboardView })),
);
import { CreateClientModal } from "./components/CreateClientModal";
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ClientProgressReportView = lazy(() =>
  import("./components/ClientProgressReportView").then((m) => ({ default: m.ClientProgressReportView })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
const ClientClinicalReviewPreloader = lazy(() =>
  import("./components/ClientClinicalReviewPreloader").then((m) => ({ default: m.ClientClinicalReviewPreloader })),
);
// Lazy-loaded: downloaded on first visit to this view, not at app start.
import { FeedbackProvider, FeedbackButton } from "./features/feedback";
import { NotificationBell } from "./features/notifications";
const StudioTasksView = lazy(() =>
  import("./features/studio-tasks").then((m) => ({
    default: m.StudioTasksView,
  })),
);
const CatalogView = lazy(() =>
  import("./features/catalog").then((m) => ({ default: m.CatalogView })),
);
import { MaxStrengthLogo } from "./components/MaxStrengthLogo";
import { ThemeToggle } from "./components/ThemeToggle";
import { HubAnnouncementsWidget } from "./components/HubAnnouncementsWidget";
import {
  isAdmin as checkIsAdmin,
  isOwner,
  isStudioLeader,
} from "./lib/permissions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Shown in the content area while a lazy view downloads on first visit.
const ViewLoader = () => (
  <div className="flex flex-1 items-center justify-center min-h-[40vh]">
    <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

const DEFAULT_MACHINES: Machine[] = [
  {
    id: "m-neck",
    anatomicalRegion: "Neck",
    name: "CX (4 WAY NECK)",
    targetMuscles: "Cervical Paraspinals, Suboccipitals",
    kinematicClassification: "Simple / Rotary",
    order: 1,
    settingOptions: ["Gap", "Back Pad", "Seat"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    requiresHandoff: true,
  },
  {
    id: "m-overhead-press",
    anatomicalRegion: "Shoulder",
    name: "OVERHEAD PRESS",
    targetMuscles: "Anterior/Medial Deltoids, Triceps",
    kinematicClassification: "Compound Push",
    order: 2,
    settingOptions: ["Gap", "Seat"],
    executionPosture: "Posterior Pelvic Tilt / Contracted Abdomen",
  },
  {
    id: "m-lateral-raise",
    anatomicalRegion: "Shoulder",
    name: "LATERAL RAISE",
    targetMuscles: "Medial Deltoids",
    kinematicClassification: "Simple Push",
    order: 3,
    settingOptions: ["Gap", "Seat", "Handles"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
  },
  {
    id: "m-pulldown",
    anatomicalRegion: "Back",
    name: "PULLDOWN",
    targetMuscles: "Latissimus Dorsi, Trapezius, Biceps",
    kinematicClassification: "Compound Pull",
    order: 4,
    settingOptions: ["Gap", "Back Pad", "Seat", "Handles"],
    setupGap: "Gap 2",
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    requiresHandoff: true,
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
  {
    id: "m-pullover",
    anatomicalRegion: "Back",
    name: "SEATED PULLOVER",
    targetMuscles: "Latissimus Dorsi",
    kinematicClassification: "Simple Pull",
    order: 5,
    settingOptions: ["Gap", "Seat", "Handles"],
    executionPosture: "Posterior Pelvic Tilt / Contracted Abdomen",
    requiresHandoff: true,
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
  {
    id: "m-compound-row",
    anatomicalRegion: "Back",
    name: "COMPOUND ROW",
    targetMuscles: "Latissimus Dorsi, Rhomboids, Trapezius",
    kinematicClassification: "Compound Pull",
    order: 6,
    settingOptions: ["Gap", "Chest Pad", "Handles"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    requiresHandoff: true,
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
  {
    id: "m-simple-row",
    anatomicalRegion: "Back",
    name: "SIMPLE ROW",
    targetMuscles: "Posterior Deltoids, Rhomboids",
    kinematicClassification: "Simple Pull",
    order: 7,
    settingOptions: ["Gap", "Chest Pad", "Seat Pad"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
  {
    id: "m-chest-press",
    anatomicalRegion: "Chest",
    name: "CHEST PRESS",
    targetMuscles: "Pectoralis Major, Anterior Deltoids",
    kinematicClassification: "Compound Push",
    order: 8,
    settingOptions: ["Gap", "Back Pad", "Seat"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
  },
  {
    id: "m-chest-fly",
    anatomicalRegion: "Chest",
    name: "CHEST/PEC FLY",
    targetMuscles: "Pectoralis Major",
    kinematicClassification: "Simple Push",
    order: 9,
    settingOptions: ["Gap", "Back Pad", "Seat"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
  },
  {
    id: "m-bicep",
    anatomicalRegion: "Arm / Upper Extremity",
    name: "BICEP",
    targetMuscles: "Biceps Brachii, Brachioradialis",
    kinematicClassification: "Simple Pull",
    order: 10,
    settingOptions: ["Gap", "Seat"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
  {
    id: "m-tricep-ext",
    anatomicalRegion: "Arm / Upper Extremity",
    name: "TRICEP EXTENSION",
    targetMuscles: "Triceps Brachii",
    kinematicClassification: "Simple Push",
    order: 11,
    settingOptions: ["Gap", "Seat"],
    executionPosture: "Posterior Pelvic Tilt / Contracted Abdomen",
  },
  {
    id: "m-dip",
    anatomicalRegion: "Arm / Upper Extremity",
    name: "SEATED DIP",
    targetMuscles: "Triceps Brachii, Lower Pectoralis",
    kinematicClassification: "Compound Push",
    order: 12,
    settingOptions: [
      "Gap",
      "Back Pad Height",
      "Back Pad Angle",
      "Seat",
      "Handles",
    ],
    executionPosture: "Posterior Pelvic Tilt / Contracted Abdomen",
  },
  {
    id: "m-abs",
    anatomicalRegion: "Core",
    name: "SEATED ABDOMINALS",
    targetMuscles: "Rectus Abdominis",
    kinematicClassification: "Simple Push",
    order: 13,
    settingOptions: ["Gap", "Seat"],
    executionPosture: "Posterior Pelvic Tilt / Contracted Abdomen",
    requiresHandoff: true,
  },
  {
    id: "m-lumbar",
    anatomicalRegion: "Core",
    name: "LUMBAR",
    targetMuscles: "Lumbar Paraspinals",
    kinematicClassification: "Simple Pull",
    order: 14,
    settingOptions: ["Gap", "Seat"],
    setupGap: "Gap 4-6",
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    sequencingContraindications: [
      "Do not pair immediately before Leg Press or Leg Curl (lumbar pump exacerbation).",
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
    primaryMuscles: ["Erector Spinae"],
    biomechanicalNotes:
      "Ensure rotation point aligns perfectly with the iliac crest. Focuses intensely on spinal extension.",
    contraindicatedFor: [
      "Spinal Stenosis",
      "Herniated Disc (Acute)",
      "Spondylolisthesis",
    ],
    modifications:
      "Limit strictly to pain-free ROM. Decrease weight if form breaks or anterior pelvic tilt is lost.",
  },
  {
    id: "m-torso-rotation",
    anatomicalRegion: "Core",
    name: "TORSO ROTATION",
    targetMuscles: "Internal and External Obliques",
    kinematicClassification: "Simple Rotary",
    order: 15,
    settingOptions: ["Gap", "Arms", "Seat"],
    executionPosture: "Posterior Pelvic Tilt / Contracted Abdomen",
  },
  {
    id: "m-hip-abd",
    anatomicalRegion: "Hip",
    name: "HIP ABDUCTION",
    targetMuscles: "Gluteus Medius, Gluteus Minimus",
    kinematicClassification: "Simple Push",
    order: 16,
    settingOptions: ["Gap", "Back Pad", "Thigh Pads"],
    setupGap: "Custom Gap",
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
  },
  {
    id: "m-hip-add",
    anatomicalRegion: "Hip",
    name: "HIP ADDUCTION",
    targetMuscles: "Adductor Longus, Brevis, Magnus",
    kinematicClassification: "Simple Pull",
    order: 17,
    settingOptions: ["Gap", "Back Pad"],
    setupGap: "Custom Gap",
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
  {
    id: "m-leg-press",
    anatomicalRegion: "Thigh / Quad",
    name: "LEG PRESS",
    targetMuscles: "Quadriceps, Gluteus Maximus, Hamstrings",
    kinematicClassification: "Compound Push",
    order: 18,
    settingOptions: ["Gap", "Seat Angle", "Shoulder Pads", "Seat Distance"],
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    primaryMuscles: ["Quadriceps", "Gluteus Maximus"],
    biomechanicalNotes:
      "Knee angle should not exceed 90 degrees at bottom turnaround to protect patellar tendon. High shear force potential on L4/L5 if posterior pelvic tilt occurs.",
    contraindicatedFor: [
      "Lumbar Issues",
      "Knee Replacement",
      "Severe Patellar Tendonitis",
    ],
    modifications:
      "For Lumbar issues: Lock seat angle to P2 or P1, limit ROM to prevent pelvic tuck. For Knee issues: Reduce gap, set end-stop earlier to prevent deep flexion.",
  },
  {
    id: "m-ext",
    anatomicalRegion: "Thigh / Quad",
    name: "LEG EXTENSION",
    targetMuscles: "Quadriceps Femoris",
    kinematicClassification: "Simple Push",
    order: 19,
    settingOptions: ["Gap", "Back Pad"],
    setupGap: "Gap 2",
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
  },
  {
    id: "m-leg-curl",
    anatomicalRegion: "Hamstring / Glute",
    name: "LEG CURL",
    targetMuscles: "Hamstrings, Gastrocnemius",
    kinematicClassification: "Simple Pull",
    order: 20,
    settingOptions: ["Gap", "Back Pad", "Ankle Pad"],
    setupGap: "Gap 2",
    executionPosture: "Chest Up / Anterior Pelvic Tilt",
    sequencingContraindications: [
      "Avoid back-to-back pulling exercises to prevent localized forearm/biceps fatigue limiting torso stimulation.",
    ],
  },
];

export const getMachineImageUrl = (machineId?: string): string => {
  const map: Record<string, string> = {
    "m-neck": "1534438327276-14e5300c3a48", // Using back/shoulder for neck
    "m-overhead-press": "1581009146145-b5ef050c2e1e", // pressing
    "m-lateral-raise": "1581009146145-b5ef050c2e1e", // shoulders
    "m-pulldown": "1526506114805-4f329971bc30", // back/pull-up
    "m-pullover": "1526506114805-4f329971bc30", // back
    "m-compound-row": "1534438327276-14e5300c3a48", // rowing
    "m-simple-row": "1534438327276-14e5300c3a48", // rowing
    "m-chest-press": "1574680096145-d05b474e2155", // chest press
    "m-chest-fly": "1574680096145-d05b474e2155", // chest
    "m-bicep": "1581009137042-c56a8411b229", // biceps
    "m-tricep-ext": "1581009137042-c56a8411b229", // arms
    "m-dip": "1574680096145-d05b474e2155", // chest/arms
    "m-abs": "1517836357463-d25dfeac3438", // abs
    "m-lumbar": "1584466977773-e35492d52dc7", // core/stretch
    "m-torso-rotation": "1517836357463-d25dfeac3438", // abs
    "m-hip-abd": "1599058917212-d750089bc07e", // lower body
    "m-hip-add": "1599058917212-d750089bc07e", // lower body
    "m-leg-press": "1540497077202-7c8a3999166f", // leg press
    "m-ext": "1540497077202-7c8a3999166f", // legs
    "m-leg-curl": "1599058917212-d750089bc07e", // hamstrings
  };
  const unsplashId =
    machineId && map[machineId] ? map[machineId] : "1518611012118-696072aa579a";
  return `https://images.unsplash.com/photo-${unsplashId}?auto=format&fit=crop&w=800&h=450&q=80`;
};

import { useActiveStudio } from "./ActiveStudioContext";

// Lazy-loaded: downloaded on first visit to this view, not at app start.
const PurchaseView = lazy(() =>
  import("./components/mindbody/PurchaseView").then((m) => ({ default: m.PurchaseView })),
);

import { useTrainers } from "./hooks/useTrainers";
import { useStudios } from "./hooks/useStudios";
import { useNetworks } from "./hooks/useNetworks";
import { useMachines } from "./hooks/useMachines";
import { useSessions } from "./hooks/useSessions";
import { useLiveSchedule } from "./hooks/useLiveSchedule";
import { useHubAnnouncements } from "./hooks/useHubAnnouncements";
import { useClientMutations } from "./hooks/useClientMutations";
import { StrongConfirmationModal } from "./components/StrongConfirmationModal";

export default function AppContent({
  user,
  authTrainer,
  setAuthTrainer,
  studios,
  setStudios,
  trainers,
  setTrainers,
  networks,
  setNetworks,
  handleLogout,
  tokenRole,
}: {
  user: FirebaseUser;
  authTrainer: Trainer;
  setAuthTrainer: (t: Trainer | null) => void;
  studios: Studio[];
  setStudios: (s: Studio[]) => void;
  trainers: Trainer[];
  setTrainers: (t: Trainer[]) => void;
  networks: FranchiseNetwork[];
  setNetworks: (n: FranchiseNetwork[]) => void;
  handleLogout: () => Promise<void>;
  tokenRole: string | null;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const { theme } = useTheme();
  const {
    activeStudioId,
    setActiveStudioId,
    isChangingStudio,
    setIsChangingStudio,
    isAdmin,
    setIsAuthenticated,
  } = useActiveStudio();
  const [isSyncing, setIsSyncing] = useState(false);
  const [appMode, setAppMode] = useState<"trainer" | "admin">("trainer");
  const [currentView, setCurrentView] = useState<View>("clients");
  const [newClientOnboardingName, setNewClientOnboardingName] = useState<
    string | null
  >(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientDoc, setSelectedClientDoc] = useState<Client | null>(
    null,
  );
  /** Id of the last client whose fetch finished, successfully or not. */
  const [resolvedClientId, setResolvedClientId] = useState<string | null>(null);

  // Derived rather than a flag set inside the effect: effects run *after* render,
  // so a boolean would still read false on the first paint and flash the
  // "not found" state before loading even began.
  const isLoadingClient =
    !!selectedClientId && resolvedClientId !== selectedClientId;
  const [hasQuotaError, setHasQuotaError] = useState(false);
  const [lastQuotaErrorMessage, setLastQuotaErrorMessage] = useState("");

  const triggerQuotaError = (msg: string) => {
    setHasQuotaError(true);
    setLastQuotaErrorMessage(msg);
  };

  useEffect(() => {
    const handleGlobalQuotaError = (e: any) => {
      if (e.message?.toLowerCase().includes("quota")) {
        triggerQuotaError(e.message);
      }
    };
    window.addEventListener("error", handleGlobalQuotaError);
    return () => window.removeEventListener("error", handleGlobalQuotaError);
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      setSelectedClientDoc(null);
      setResolvedClientId(null);
      return;
    }

    let cancelled = false;
    setSelectedClientDoc(null);

    const fetchClient = async () => {
      try {
        const clientRef = doc(db, "clients", selectedClientId);
        const snap = await getDoc(clientRef);
        if (cancelled) return;
        if (snap.exists()) {
          setSelectedClientDoc({ id: snap.id, ...snap.data() } as Client);
        } else {
          setSelectedClientDoc(null);
        }
      } catch (e) {
        console.error("Error fetching client", e);
      } finally {
        // Marks the fetch as settled so the profile stops showing the spinner,
        // whether the client was found, missing, or the read failed.
        if (!cancelled) setResolvedClientId(selectedClientId);
      }
    };
    fetchClient().catch((err) =>
      console.error("Unhandled rejection in fetchClient:", err),
    );

    // Switching clients mid-flight must not let a stale response win.
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedProfileTrainerId, setSelectedProfileTrainerId] = useState<
    string | null
  >(null);
  const [leaderboardReturnView, setLeaderboardReturnView] =
    useState<View>("trainer-hub");

  const isDataReady = !!authTrainer && !hasQuotaError;

  useTrainers(isDataReady, setTrainers);
  useStudios(isDataReady, setStudios);
  useNetworks(isDataReady, setNetworks);

  const { machines } = useMachines(isDataReady, DEFAULT_MACHINES);
  const { schedules, liveRosterClients } = useLiveSchedule(
    activeStudioId,
    isDataReady,
  );
  const { sessions } = useSessions(activeStudioId, isDataReady);
  const { announcements } = useHubAnnouncements(authTrainer, activeStudioId);
  const [trainerFocuses, setTrainerFocuses] = useState<TrainerFocus[]>([]);

  const clients = Array.from(
    new Map(
      [
        ...(selectedClientDoc ? [selectedClientDoc] : []),
        ...liveRosterClients,
      ].map((c) => [c.id, c]),
    ).values(),
  );
  const [showNewClientsDialog, setShowNewClientsDialog] = useState(false);
  const [isReorderingTrainers, setIsReorderingTrainers] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isIntroSession, setIsIntroSession] = useState(false);
  const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
  /**
   * Global client search. The input lives in the app header, but the results
   * render inside the Hub (ClientsView), so the term is owned here and handed
   * down. Leaving the Hub clears it, which keeps the daily grid as the default
   * view whenever a trainer comes back.
   */
  const [hubSearchTerm, setHubSearchTerm] = useState("");
  const hubSearchInputRef = useRef<HTMLInputElement | null>(null);

  const {
    startUnassignedSession,
    updateClient,
    submitClientFormData,
    updateClientSessions,
    handleDeleteClient,
    isMutating,
  } = useClientMutations(
    authTrainer,
    activeStudioId,
    machines,
    setSelectedClientId,
    setCurrentView,
  );

  const handleRefreshSchedule = async () => {
    const activeStudio = studios.find((s) => s.id === activeStudioId);

    if (!activeStudio?.mindbodySiteId) {
      toastError(
        `${activeStudio?.name || "This studio"} has no MindBody Site ID. Set it in Admin → Studios before syncing.`,
      );
      return;
    }

    const sharesSite = studios.some(
      (s) =>
        s.id !== activeStudio.id &&
        s.mindbodySiteId &&
        String(s.mindbodySiteId).trim() ===
          String(activeStudio.mindbodySiteId).trim(),
    );
    if (sharesSite && !activeStudio.mindbodyLocationId) {
      toastError(
        `${activeStudio.name} shares MindBody Site ${activeStudio.mindbodySiteId} with another studio but has no Location ID. Set it in Admin → Studios to keep schedules separate.`,
      );
      return;
    }

    setIsRefreshingSchedule(true);
    try {
      const siteId = String(activeStudio.mindbodySiteId);

      const { syncMindbodySchedules } = await import("./lib/mindbody-api-sync");
      const res = await syncMindbodySchedules(
        siteId,
        trainers,
        clients,
        studios,
        null,
        undefined,
        undefined,
        activeStudioId,
        activeStudio?.mindbodyLocationId,
      );

      if (res.errors && res.errors.length > 0) {
        toastError(`Sync completed with issues: ${res.errors[0]}`);
      } else {
        toastSuccess(
          `Schedule refreshed: ${res.added} added, ${res.updated} updated.`,
        );
      }
      console.log("Schedule refresh result:", res);
    } catch (error: any) {
      console.error("Failed to refresh schedule:", error);
      toastError("Failed to refresh schedule: " + error.message);
    } finally {
      setIsRefreshingSchedule(false);
    }
  };

  const setView = (view: View, data?: { isIntroSession?: boolean }) => {
    if (data?.isIntroSession) {
      setIsIntroSession(true);
    } else {
      setIsIntroSession(false);
    }
    setCurrentView(view);
  };

  useEffect(() => {
    if (currentView !== "clients") setHubSearchTerm("");
  }, [currentView]);

  const newClientsThisMonth = useMemo(() => {
    return clients.filter((c) => {
      if (!c.createdAt) return false;
      const createdAt = c.createdAt?.toDate?.() || new Date(c.createdAt);
      const now = new Date();
      return (
        createdAt.getMonth() === now.getMonth() &&
        createdAt.getFullYear() === now.getFullYear()
      );
    });
  }, [clients]);

  const sortedTrainers = useMemo(() => {
    return [...trainers].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [trainers]);

  const currentSession = useMemo(() => {
    return sessions.find(
      (s) =>
        s.status === "In-Progress" &&
        s.clientId === selectedClientId &&
        isSessionValid(s),
    );
  }, [sessions, selectedClientId]);
  // Derived state for the active studio name
  const activeStudioName = useMemo(() => {
    if (!activeStudioId) return null;
    return studios.find((s) => s.id === activeStudioId)?.name || null;
  }, [activeStudioId, studios]);

  const [clientFormData, setClientFormData] = useState({
    firstName: "",
    lastName: "",
    gender: "Male" as "Male" | "Female" | "Other",
    heightFeet: "",
    heightInches: "",
    weight: "",
    age: "",
    occupation: "",
    phone: "",
    email: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    isActive: true,
    isRoutineBActive: false,
    medicalHistory: "",
    globalNotes: "",
    remainingSessions: 10,
    mindbody_name: "",
  });

  const startEditClient = (client: Client) => {
    setEditingClient(client);

    // Parse height string (e.g., "5' 10\"")
    let ft = "";
    let inc = "";
    if (client.height) {
      if (client.height.includes("'")) {
        const parts = client.height.split("'");
        ft = parts[0].trim();
        if (parts[1]) {
          inc = parts[1].replace('"', "").trim();
        }
      } else {
        // Fallback for old numeric data (assuming inches if > 15)
        const totalInches = parseInt(client.height);
        if (!isNaN(totalInches) && totalInches > 15) {
          ft = Math.floor(totalInches / 12).toString();
          inc = (totalInches % 12).toString();
        } else {
          ft = client.height;
        }
      }
    }

    setClientFormData({
      firstName: client.firstName,
      lastName: client.lastName,
      gender: client.gender,
      heightFeet: ft,
      heightInches: inc,
      height: client.height, // Keep for legacy if needed momentarily
      weight: client.weight || "",
      age: client.age?.toString() || "",
      occupation: client.occupation || "",
      phone: client.phone || "",
      email: client.email || "",
      address: client.address || "",
      emergencyContactName: client.emergencyContactName || "",
      emergencyContactPhone: client.emergencyContactPhone || "",
      isActive: client.isActive,
      isRoutineBActive: client.isRoutineBActive || false,
      remainingSessions: client.remainingSessions,
      medicalHistory: client.medicalHistory || "",
      globalNotes: client.globalNotes || "",
    });
    // setIsAddingClient removed as we use editingClient state or the new modal for creation
  };

  const updateStudio = async (studioId: string, updates: Partial<Studio>) => {
    try {
      await updateDoc(doc(db, "studios", studioId), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await submitClientFormData(clientFormData as any, editingClient);

      if (editingClient) {
        setEditingClient(null);
      }

      setClientFormData({
        firstName: "",
        lastName: "",
        gender: "Male",
        heightFeet: "",
        heightInches: "",
        height: "",
        weight: "",
        age: "",
        occupation: "",
        phone: "",
        email: "",
        address: "",
        emergencyContactName: "",
        emergencyContactPhone: "",
        isActive: true,
        isRoutineBActive: false,
        medicalHistory: "",
        globalNotes: "",
        remainingSessions: 10,
        mindbody_name: "",
      });
    } catch (error) {
      // Error handled by hook
    }
  };

  const [showClientPicker, setShowClientPicker] = useState(false);
  const [infoMachineId, setInfoMachineId] = useState<string | null>(null);
  const [isEditingMachineInfo, setIsEditingMachineInfo] = useState(false);
  const [machineInfoDraft, setMachineInfoDraft] = useState<Partial<Machine>>(
    {},
  );

  const infoMachine = machines.find((m) => m.id === infoMachineId);

  useEffect(() => {
    if (infoMachine) {
      setMachineInfoDraft(infoMachine);
    }
  }, [infoMachine]);

  // Trainer Session Persistence
  useEffect(() => {
    // Check for view override in URL (for emergency admin access)
    const urlParams = new URLSearchParams(window.location.search);
    const viewOverride = urlParams.get("view");

    const viewBypassAdmin =
      tokenRole === "Admin" ||
      authTrainer?.role === "Admin" ||
      tokenRole === "Founder" ||
      authTrainer?.role === "Founder" ||
      tokenRole === "Overseer";
    if (viewOverride === "trainer-hub" && viewBypassAdmin) {
      if (trainers.length > 0) {
        const ownerTrainer = trainers.find((t) => isOwner(t)) || trainers[0];
        if (authTrainer?.id !== ownerTrainer.id) {
          setAuthTrainer(ownerTrainer);
          setCurrentView("trainer-hub");
        }
      } else if (!authTrainer) {
        // Mock a trainer if none exist for bypass
        setAuthTrainer({
          id: "owner-temp",
          fullName: "Owner Tim",
          initials: "TD",
          pin: "0000",
          role: "Owner",
        } as any);
        setCurrentView("trainer-hub");
      }
      return;
    }

    if (trainers.length > 0) {
      if (!authTrainer) {
        const savedId = localStorage.getItem("max_strength_trainer_id");
        if (savedId) {
          const matching = trainers.find((t) => t.id === savedId);
          if (matching) setAuthTrainer(matching);
        }
      } else {
        // Check if the current trainer was deleted
        // SAFETY: Only lock if we have a significant number of trainers loaded
        // and we still can't find the current one. This avoids flicker-lockouts.
        const stillExists = trainers.find((t) => t.id === authTrainer.id);
        if (
          !stillExists &&
          authTrainer.id !== "owner-temp" &&
          trainers.length >= 1
        ) {
          // If we have trainers but not ours, it might be a deletion.
          // BUT let's wait a bit longer or check if trainers list changed significantly.
          // For now, let's just make it more resilient by not locking if the list is likely incomplete.
          if (trainers.length >= 1) {
            console.log(
              "Current trainer not found in active list, verifying existence...",
            );
            // We'll keep them logged in for this frame to avoid a flash.
          }
        }
      }
    }
  }, [trainers.length, authTrainer?.id, user?.email, tokenRole]);

  const handleTrainerLogin = (trainer: Trainer) => {
    // Admin Override: If logged in as claims admin, elevate profile role
    const isClaimsAdmin =
      tokenRole === "Admin" ||
      tokenRole === "Founder" ||
      tokenRole === "Overseer";
    if (
      isClaimsAdmin &&
      (trainer.role === "Trainer" || trainer.role === "LifeTransformer")
    ) {
      trainer.role = "Admin";
    }
    setAuthTrainer(trainer);
    localStorage.setItem("max_strength_trainer_id", trainer.id!);
  };

  const handleTrainerLock = () => {
    setAuthTrainer(null);
    localStorage.removeItem("max_strength_trainer_id");
  };

  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);

  const handleAppCleanse = () => {
    setIsWipeModalOpen(true);
  };

  const executeAppCleanse = async () => {
    setIsWipeModalOpen(false);

    try {
      const collectionsToWipe = [
        "studios",
        "clients",
        "trainers",
        "sessions",
        "exerciseLogs",
        "clientMachineSettings",
        "routines",
        "routineAdjustments",
        "schedules",
        "sessionNotes",
        "machineSettingChanges",
      ];

      console.log("Starting cleanse...");
      for (const colName of collectionsToWipe) {
        const snap = await getDocs(collection(db, colName));
        console.log(`Clearing ${colName} (${snap.size} docs)...`);
        const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
        await Promise.all(deletePromises);
      }

      console.log("Wipe complete. Machines were preserved.");

      // Clear local state
      setAuthTrainer(null);
      localStorage.removeItem("max_strength_trainer_id");
      setSelectedClientId(null);
      setCurrentView("clients");

      toastSuccess(
        "Application cleansed (studios, clients, users removed). Machines preserved. The app will now reload.",
      );
      window.location.href = window.location.origin + window.location.pathname;
    } catch (error: any) {
      console.error("Cleanse failed:", error);
      toastError(
        `Cleanse failed: ${error.message || "Unknown error"}. Please check your connection or permissions.`,
      );
    }
  };

  const handleSeedDemoClient = async () => {
    try {
      const trainerId =
        authTrainer?.id || auth.currentUser?.uid || "demo-trainer";
      const trainerInitials = authTrainer?.initials || "JD";

      // 1. Create the Client with a unique-ish ID to avoid collisions
      const demoClientRef = doc(collection(db, "clients"));
      await setDoc(demoClientRef, {
        firstName: "John",
        lastName: "Demo",
        gender: "Male",
        height: "5' 10\"",
        weight: "185",
        age: 35,
        isActive: true,
        isRoutineBActive: true,
        remainingSessions: 12,
        consultationCompleted: true,
        email: `john.demo.${Date.now()}@example.com`,
        createdAt: serverTimestamp(),
      });

      const demoClientId = demoClientRef.id;

      // 2. Define and Create Routines
      const routineAIds = [
        "m-hip-add",
        "m-hip-abd",
        "m-leg-press",
        "m-compound-row",
        "m-dip",
        "m-lumbar",
        "m-torso-rotation",
      ];
      const routineBIds = [
        "m-leg-curl",
        "m-leg-ext",
        "m-pulldown",
        "m-overhead-press",
        "m-abs",
        "m-torso-rotation",
      ];

      await addDoc(collection(db, "routines"), {
        clientId: demoClientId,
        name: "A",
        machineIds: routineAIds,
        createdAt: serverTimestamp(),
        studioId: activeStudioId,
      });

      await addDoc(collection(db, "routines"), {
        clientId: demoClientId,
        name: "B",
        machineIds: routineBIds,
        createdAt: serverTimestamp(),
        studioId: activeStudioId,
      });

      // 3. Generate 2 months of history (16 sessions)
      const now = new Date();

      for (let i = 0; i < 16; i++) {
        const sessionDate = new Date(now);
        sessionDate.setDate(now.getDate() - (15 - i) * 3.5);
        const dateStr = sessionDate.toISOString().split("T")[0];
        const isRoutineA = i % 2 === 0;
        const routineName = isRoutineA ? "A" : "B";
        const machineIds = isRoutineA ? routineAIds : routineBIds;

        const ts = Timestamp.fromDate(sessionDate);
        const sessionRef = await addDoc(collection(db, "sessions"), {
          clientId: demoClientId,
          trainerId: trainerId,
          trainerInitials: trainerInitials,
          date: dateStr,
          hostedAtStudioId: activeStudioId || "solon",
          clientHomeStudioId: activeStudioId || "solon",
          isCrossTrain: false,
          routineName: routineName,
          sessionType: "Standard",
          sessionNumber: i + 1,
          status: "Completed",
          createdAt: ts,
          startTime: ts,
          endTime: ts,
        });

        // Add logs with progressive weights
        const logPromises = machineIds.map((mId, mIdx) => {
          const baseWeight = 50 + mIdx * 20;
          const weightValue = baseWeight + i * 5;

          const logData: any = {
            sessionId: sessionRef.id,
            clientId: demoClientId,
            machineId: mId,
            weight: weightValue.toString(),
            createdAt: ts,
          };

          // Special logic for new data properties
          if (mId === "m-torso-rotation") {
            // Bilateral reps
            logData.repsLeft = 10 + (i % 3);
            logData.repsRight = 10 + (i % 2);
          } else if (mId === "m-lumbar" && i % 4 === 0) {
            // TSC protocol test
            logData.isTSC = true;
            logData.reps = "90";
            logData.seconds = "90"; // 90 seconds for display
            logData.isStaticHold = true;
          } else {
            logData.reps = (8 + (i % 4)).toString();
          }

          return addDoc(collection(db, "exerciseLogs"), logData);
        });
        await Promise.all(logPromises);
      }

      toastSuccess(
        "Demo Client 'John Demo' generated with 2 months of history!",
      );
    } catch (err: any) {
      console.error("Demo seeding failed:", err);
      toastError(`Demo seeding failed: ${err.message || "Unknown error"}`);
    }
  };

  const handleRestoreMachines = async () => {
    try {
      const promises = DEFAULT_MACHINES.map((machine) =>
        setDoc(
          doc(db, "machines", machine.id!),
          {
            ...machine,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ),
      );

      await Promise.all(promises);
      toastSuccess(`Standard units enforced successfully.`);
    } catch (error: any) {
      console.error("Restore failed:", error);
      toastError(`Restore failed: ${error.message || "Unknown error"}`);
    }
  };

  const handleManualRefresh = async (
    collectionName: "studios" | "networks" | "trainers",
  ) => {
    try {
      if (collectionName === "studios") {
        const snap = await getDocs(collection(db, "studios"));
        setStudios(
          snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Studio),
        );
      } else if (collectionName === "networks") {
        const snap = await getDocs(collection(db, "networks"));
        setNetworks(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as FranchiseNetwork,
          ),
        );
      } else if (collectionName === "trainers") {
        const snap = await getDocs(collection(db, "trainers"));
        setTrainers(
          snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Trainer),
        );
      }
    } catch (e) {
      console.error("Manual refresh failed", e);
    }
  };

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  /** Microsoft sign-in is limited to company staff. */
  const MICROSOFT_ALLOWED_DOMAIN = "maxstrengthfitness.com";

  const handleLogin = async (providerName: "google" | "microsoft") => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      let provider;
      if (providerName === "google") {
        provider = new GoogleAuthProvider();
      } else {
        provider = new OAuthProvider("microsoft.com");

        const rawTenant = (
          (import.meta as any).env.VITE_MICROSOFT_TENANT_ID || ""
        ).trim();
        const isValidTenant =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            rawTenant,
          ) || ["common", "organizations", "consumers"].includes(rawTenant);

        if (rawTenant && !isValidTenant) {
          console.warn(
            `Ignoring VITE_MICROSOFT_TENANT_ID="${rawTenant}" — not a tenant GUID or known alias. Falling back to /common.`,
          );
        }

        provider.setCustomParameters({
          prompt: "select_account",
          ...(isValidTenant ? { tenant: rawTenant } : {}),
        });
        // Ask for the profile fields Firebase needs to populate user.email.
        provider.addScope("openid");
        provider.addScope("email");
        provider.addScope("profile");
        provider.addScope("User.Read");
      }
      const credential = await signInWithPopup(auth, provider);

      // Microsoft sign-in is for company staff only. The single-tenant Azure app
      // already blocks outsiders, but a guest invited into the tenant would
      // otherwise slip through, so the address is checked here too.
      if (providerName === "microsoft") {
        const signedInEmail = (
          credential.user.email ||
          credential.user.providerData.find((p) => p?.email)?.email ||
          ""
        ).toLowerCase();

        if (!signedInEmail.endsWith(`@${MICROSOFT_ALLOWED_DOMAIN}`)) {
          await signOut(auth);
          setLoginError(
            `Microsoft sign-in is restricted to @${MICROSOFT_ALLOWED_DOMAIN} accounts. ${
              signedInEmail
                ? `"${signedInEmail}" is not permitted.`
                : "That account has no usable email address."
            }`,
          );
          return;
        }
      }
    } catch (error: any) {
      if (
        error.code === "auth/popup-closed-by-user" ||
        error.code === "auth/cancelled-popup-request"
      ) {
        return;
      }
      console.error("Login failed:", error);

      const errMsg = error.message || "";
      if (
        errMsg.includes("unauthorized_client") ||
        errMsg.includes("not enabled for consumers")
      ) {
        setLoginError(
          "Login failed: this Microsoft app does not accept personal Microsoft accounts. Set VITE_MICROSOFT_TENANT_ID=organizations in .env (or your tenant GUID if the app is single-tenant) and restart the dev server.",
        );
      } else if (errMsg.includes("AADSTS50011")) {
        setLoginError(
          "Login failed: redirect URI mismatch. In Azure App Registrations, add the callback URL shown on Firebase's Microsoft provider page to your app's Web redirect URIs.",
        );
      } else if (errMsg.includes("AADSTS50194")) {
        setLoginError(
          "Login failed: Your Microsoft App Registration is configured as single-tenant. Please go to Azure Portal and configure application 'dd2ae28c-1a71-4de3-bc12-5b0683032526' to be multi-tenant ('Accounts in any organizational directory and personal Microsoft accounts'), or set VITE_MICROSOFT_TENANT_ID in your environment variables to your tenant ID.",
        );
      } else {
        setLoginError(`Login failed: ${error.message}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#1c1d1f] flex flex-col items-center justify-center p-6 focus:outline-none relative overflow-hidden">
        {/* Background Radial Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-[#005187]/20 via-[#1c1d1f] to-[#121212] opacity-80"></div>
        {/* Pattern Overlay */}
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/hexellence.png')] opacity-10 mix-blend-overlay"></div>
        {/* Edge Shadow */}
        <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.8)] pointer-events-none"></div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="w-full max-w-lg z-10 flex flex-col items-center justify-center min-h-[60vh] mt-[-5vh]"
        >
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <MaxStrengthLogo
                size="2xl"
                theme="dark"
                showSlogan={true}
                className="drop-shadow-[0_15px_35px_rgba(0,0,0,0.6)] mb-8"
              />
            </motion.div>

            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-transparent bg-clip-text bg-linear-to-r from-slate-200 via-white to-slate-400 font-extrabold tracking-[0.3em] text-2xl md:text-3xl uppercase drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]"
            >
              Journey System
            </motion.h1>
          </div>

          {loginError && (
            <div className="mt-8 bg-red-500/10 border border-red-500/50 p-4 rounded-xl text-red-100 text-sm max-w-sm text-center font-medium shadow-[0_0_15px_rgba(220,38,38,0.3)] w-full">
              {loginError}
            </div>
          )}

          <div className="mt-8 w-full flex flex-col items-center justify-center gap-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleLogin("google")}
              disabled={isLoggingIn}
              className={cn(
                "relative overflow-hidden group w-full max-w-[320px] rounded-[40px] p-0.5 shadow-[0_15px_30px_rgba(0,0,0,0.5)] transition-opacity",
                isLoggingIn ? "opacity-50 cursor-not-allowed" : "opacity-100",
              )}
            >
              {/* Outer Metallic Ring */}
              <div className="absolute inset-0 bg-linear-to-b from-[#8b9bb4] via-[#33465e] to-[#1a2b41] rounded-[40px]"></div>
              {/* Inner highlight */}
              <div className="absolute inset-px bg-linear-to-b from-white/30 to-transparent rounded-[39px]"></div>

              <div className="relative bg-[#1d2736]/90 px-8 py-4 rounded-[38px] flex flex-row items-center justify-center gap-4 w-full h-full shadow-[inset_0_2px_15px_rgba(0,0,0,0.8)] backdrop-blur-md">
                <svg
                  className="w-6 h-6 text-slate-900 dark:text-white/90"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span className="font-bold text-slate-900 dark:text-white/90 text-sm tracking-wide">
                  Continue with Google
                </span>
              </div>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleLogin("microsoft")}
              disabled={isLoggingIn}
              className={cn(
                "relative overflow-hidden group w-full max-w-[320px] rounded-[40px] p-0.5 shadow-[0_15px_30px_rgba(0,0,0,0.5)] transition-opacity",
                isLoggingIn ? "opacity-50 cursor-not-allowed" : "opacity-100",
              )}
            >
              {/* Outer Metallic Ring */}
              <div className="absolute inset-0 bg-linear-to-b from-[#8b9bb4] via-[#33465e] to-[#1a2b41] rounded-[40px]"></div>
              {/* Inner highlight */}
              <div className="absolute inset-px bg-linear-to-b from-white/30 to-transparent rounded-[39px]"></div>

              <div className="relative bg-[#1d2736]/90 px-8 py-4 rounded-[38px] flex flex-row items-center justify-center gap-4 w-full h-full shadow-[inset_0_2px_15px_rgba(0,0,0,0.8)] backdrop-blur-md">
                <svg
                  className="w-6 h-6 text-slate-900 dark:text-white/90"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" />
                </svg>
                <span className="font-bold text-slate-900 dark:text-white/90 text-sm tracking-wide">
                  Continue with Microsoft
                </span>
              </div>
            </motion.button>
          </div>
        </motion.div>

        <div className="absolute bottom-6 w-full text-center z-10 px-6 flex flex-col items-center gap-3">
          <p className="text-slate-900 dark:text-white/30 text-[10px] sm:text-xs tracking-wider uppercase font-medium">
            Master/Admin Credentials Required for Administrative Portal Access
          </p>
          <div className="text-[#ff9800] font-black text-xs uppercase tracking-widest transition-colors mb-4 md:mb-0">
            No Account? Sign in to Request Access.
          </div>
        </div>
      </div>
    );
  }

  // Intercept authenticated but unauthorized users
  if (user && !authTrainer) {
    return (
      <AccessRequestView
        authenticatedUser={user}
        studios={studios}
        onTrainerCreated={setAuthTrainer}
        onLogout={handleLogout}
      />
    );
  }

  // Derived state for the active studio name
  // Moved up to avoid hook order violation

  // Studio Selection Screen (if no active studio or changing studio)
  if (
    (!activeStudioId || isChangingStudio) &&
    currentView !== "admin-dashboard"
  ) {
    return (
      <StudioSelectionView
        studios={studios}
        networks={networks}
        trainers={trainers}
        authTrainer={authTrainer}
        onSelectTrainer={(selectedTrainer, studioId) => {
          setActiveStudioId(studioId);
          setAuthTrainer(selectedTrainer);
          localStorage.setItem("max_strength_trainer_id", selectedTrainer.id!);
          const hasPin = selectedTrainer.pin || selectedTrainer.pinHash;
          if (!hasPin) {
            localStorage.setItem("max_strength_authenticated", "true");
            setIsAuthenticated(true);
          } else {
            localStorage.setItem("max_strength_authenticated", "false");
            setIsAuthenticated(false);
          }
          setIsChangingStudio(false);
        }}
        onGoToAdmin={() => {
          setAppMode("admin");
          setCurrentView("admin-dashboard");
          setIsChangingStudio(false);
        }}
        onBack={() => {
          if (!activeStudioId) {
            handleLogout().catch(console.error);
          } else {
            setIsChangingStudio(false);
          }
        }}
      />
    );
  }

  // Access Request Screen (if authenticated via Google but no matching profile exists)
  if (!authTrainer) {
    return (
      <AccessRequestView
        authenticatedUser={user}
        studios={studios}
        onTrainerCreated={(t) => {
          setAuthTrainer(t);
        }}
        onLogout={handleLogout}
      />
    );
  }

  if (newClientOnboardingName !== null) {
    return (
      <CreateClientModal
        clients={clients}
        studios={studios}
        initialName={newClientOnboardingName}
        onClientCreated={async (clientId, routeToImporter) => {
          setSelectedClientId(clientId);
          setNewClientOnboardingName(null);

          if (routeToImporter) {
            setCurrentView("chart-importer");
          } else {
            setCurrentView("profile");
          }
        }}
        onClose={() => {
          setNewClientOnboardingName(null);
        }}
      />
    );
  }

  /**
   * Header search + inline schedule refresh. Typing from any screen jumps to
   * the Hub, where the results list renders. Hidden on phone widths; the app
   * is tablet-first and the Client Directory keeps its own search there.
   */
  const headerSearchSlot = (
    <div className="hidden sm:flex items-center gap-1 w-full justify-end">
      <div className="relative w-full max-w-[14rem] md:max-w-[18rem] lg:max-w-[22rem] focus-within:max-w-[26rem] lg:focus-within:max-w-[30rem] transition-[max-width] duration-200">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <Input
          ref={hubSearchInputRef}
          value={hubSearchTerm}
          onChange={(e) => {
            setHubSearchTerm(e.target.value);
            if (currentView !== "clients") setCurrentView("clients");
          }}
          placeholder="Search clients"
          aria-label="Search clients"
          className="h-10 pl-8 pr-8 rounded-lg bg-slate-100/80 dark:bg-slate-800/60 border border-transparent text-sm font-medium text-foreground placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:ring-1 focus-visible:ring-cyan/60 focus-visible:border-cyan/40 focus-visible:bg-white dark:focus-visible:bg-slate-900"
        />
        {hubSearchTerm && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setHubSearchTerm("");
              hubSearchInputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleRefreshSchedule}
        disabled={isRefreshingSchedule}
        title={isRefreshingSchedule ? "Syncing schedule…" : "Refresh schedule"}
        aria-label="Refresh schedule"
        className="h-10 w-10 rounded-lg shrink-0 text-slate-500 dark:text-slate-400 hover:text-orange-500 hover:bg-transparent"
      >
        <RefreshCw
          className={`w-4 h-4 md:w-5 md:h-5 ${isRefreshingSchedule ? "animate-spin" : ""}`}
        />
      </Button>
    </div>
  );

  const headerRightControls = (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
      <ThemeToggle />
      <FeedbackButton />
      <NotificationBell
        trainerId={authTrainer?.id}
        onNavigate={(view, id) => {
          if (view === "profile" && id) setSelectedClientId(id);
          setCurrentView(view as any);
        }}
      />
      <HubAnnouncementsWidget authTrainer={authTrainer} />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCurrentView("trainer-hub")}
        className={`h-8 w-8 sm:h-10 sm:w-10 rounded-full transition-all hover:bg-transparent shrink-0 ${currentView === "trainer-hub" ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50 active:text-orange-500"}`}
        title="Trainer Control Hub"
      >
        <Settings className="w-4 h-4 sm:w-6 sm:h-6 md:w-7 md:h-7 transition-colors hover:stroke-orange-500" />
      </Button>
    </div>
  );

  const headerTrainerDropdown = authTrainer ? (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-8 h-8 sm:w-11 sm:h-11 rounded-full font-display italic text-xs sm:text-sm flex items-center justify-center cursor-pointer shadow-sm mx-auto active:scale-95 transition-transform hover:opacity-90 bg-primary text-primary-foreground shrink-0">
        {authTrainer.initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 rounded-[24px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-bg-dark p-2 shadow-2xl dark:shadow-none text-slate-700 dark:text-slate-300"
      >
        <DropdownMenuGroup>
          {isStudioLeader(authTrainer) && (
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-2">
              <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 block mb-3">
                App Mode
              </Label>
              <div className="flex bg-slate-100 dark:bg-bg-dark-3 p-1 rounded-xl">
                <button
                  onClick={() => {
                    setAppMode("trainer");
                    setCurrentView("clients");
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-[11px] font-bold uppercase tracking-widest rounded-lg transition-colors ${appMode === "trainer" ? "bg-white dark:bg-bg-dark shadow-sm text-sky-600 dark:text-sky-400" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                >
                  Trainer
                </button>
                <button
                  onClick={() => {
                    setAppMode("admin");
                    setCurrentView("admin-dashboard" as any);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-[11px] font-bold uppercase tracking-widest rounded-lg transition-colors ${appMode === "admin" ? "bg-white dark:bg-bg-dark shadow-sm text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                >
                  Admin
                </button>
              </div>
            </div>
          )}
          <DropdownMenuLabel className="font-black uppercase text-[11px] tracking-widest px-3 py-2 text-slate-500 dark:text-slate-400">
            Active Profile
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              setSelectedProfileTrainerId(null);
              setCurrentView("trainer-profile");
            }}
            className="rounded-xl flex items-center gap-3 p-3 font-bold uppercase text-[11px] tracking-widest cursor-pointer hover:bg-slate-700 hover:text-slate-900 dark:text-white dark:hover:text-slate-50 focus:bg-slate-700 focus:text-slate-900"
          >
            <UserCircle className="w-4 h-4 text-sky-500" />
            View Profile
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-2 bg-slate-700" />

        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={handleTrainerLock}
            className="rounded-xl flex items-center gap-3 p-3 font-bold uppercase text-[11px] tracking-widest text-orange-500 hover:bg-orange-500/10 dark:bg-orange-600/10 focus:bg-orange-500/10 focus:text-orange-500 cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            Switch Trainer
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setIsChangingStudio(true)}
            className="rounded-xl flex items-center gap-3 p-3 font-bold uppercase text-[11px] tracking-widest cursor-pointer hover:bg-slate-700 hover:text-slate-900 dark:text-white dark:hover:text-slate-50 focus:bg-slate-700 focus:text-slate-900"
          >
            <Building2 className="w-4 h-4 text-amber-500" />
            Switch Studio
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={handleLogout}
            className="rounded-xl flex items-center gap-3 p-3 font-bold uppercase text-[11px] tracking-widest text-rose-500 hover:bg-rose-500/10 focus:bg-rose-500/10 focus:text-rose-500 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Log Out Facility
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  return (
    <ErrorBoundary>
      {/* Mounted once, near the root, so the feedback drawer is reachable from
          every screen and there is only ever one of it. It reads the live
          "where am I" values below and snapshots them when it opens. */}
      <FeedbackProvider
        author={{
          id: authTrainer?.id,
          email: authTrainer?.email,
          name: authTrainer?.fullName,
          studioId: activeStudioId,
        }}
        view={currentView}
        studioId={activeStudioId}
        studioName={activeStudioName}
        clientId={selectedClientId}
        clientName={
          selectedClientDoc
            ? `${selectedClientDoc.firstName} ${selectedClientDoc.lastName}`.trim()
            : null
        }
        sessionId={currentSession?.id ?? null}
        theme={theme}
      >
      <div className="flex flex-col h-[100dvh] overflow-hidden bg-background text-foreground font-sans overflow-x-hidden w-full max-w-full">
        {/* Header */}
        {currentView !== "workouts" && (
          <AppHeader
            variant={theme === "light" ? "light" : "dark"}
            studioName={activeStudioName || undefined}
            onStudioClick={() => setIsChangingStudio(true)}
            rightControls={headerRightControls}
            trainerDropdown={headerTrainerDropdown}
            searchSlot={headerSearchSlot}
          />
        )}

        {/* Main Content */}
        <main
          className={`w-full max-w-full mx-auto relative ${currentView === "workouts" ? "flex-1 min-h-0 p-2 overflow-y-auto overscroll-contain bg-slate-50 dark:bg-slate-950 flex flex-col" : currentView === "clients" || currentView === "client-directory" || currentView === "dashboard" || currentView === "machine-anatomy" || currentView === "studio-tasks" ? "flex-1 min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950 p-0 flex flex-col" : "flex-1 min-h-0 p-6 overflow-y-auto overscroll-contain bg-slate-50 dark:bg-slate-950"}`}
          style={
            currentView === "clients" ||
            currentView === "client-directory" ||
            currentView === "dashboard" ||
            currentView === "machine-anatomy"
              ? undefined
              : undefined
          }
        >
          <Suspense fallback={<ViewLoader />}>
          <AnimatePresence mode="wait">
            {currentView === "consultation-wizard" && selectedClientId && (
              <ConsultationWizard
                client={
                  clients.find((c) => c.id === selectedClientId) ||
                  ({} as Client)
                }
                machines={machines}
                authTrainer={authTrainer}
                trainers={trainers}
                onComplete={(id) => {
                  setSelectedClientId(id);
                  setCurrentView("profile");
                }}
                onCancel={() => setCurrentView("profile")}
              />
            )}
            {currentView === "trainers" && (
              <ProfilesView
                trainers={trainers}
                clients={clients}
                sessions={sessions}
                schedules={schedules}
                onSelectClient={(id) => {
                  setSelectedClientId(id);
                }}
                setSelectedClientId={setSelectedClientId}
                setView={setCurrentView}
                authTrainer={authTrainer}
                onTrainerLogin={handleTrainerLogin}
                onViewTrainerProfile={(id) => {
                  setSelectedProfileTrainerId(id);
                  setCurrentView("trainer-profile");
                }}
                isAdmin={
                  tokenRole === "Admin" ||
                  authTrainer?.role === "Admin" ||
                  tokenRole === "Founder" ||
                  authTrainer?.role === "Founder"
                }
              />
            )}
            {currentView === "client-directory" && (
              <ClientDirectoryView
                clients={clients}
                onSelectClient={(id) => {
                  setSelectedClientId(id);
                  setCurrentView("profile");
                }}
                onStartOpenSession={startUnassignedSession}
                authTrainer={authTrainer}
                onUpdateSessions={updateClientSessions}
                onStartNewClientOnboarding={setNewClientOnboardingName}
              />
            )}
            {currentView === "clients" && (
              <ClientsView
                clients={clients}
                trainers={trainers}
                sortedTrainers={sortedTrainers}
                isAdmin={
                  tokenRole === "Admin" ||
                  authTrainer?.role === "Admin" ||
                  tokenRole === "Founder" ||
                  authTrainer?.role === "Founder"
                }
                activeStudioId={activeStudioId}
                authTrainer={authTrainer}
                onSelectClient={(id) => {
                  setSelectedClientId(id);
                  setView("profile");
                }}
                setView={setView}
                schedules={schedules}
                sessions={sessions}
                editingClient={editingClient}
                setEditingClient={setEditingClient}
                formData={clientFormData}
                setFormData={setClientFormData}
                onSubmit={handleClientSubmit}
                startEdit={startEditClient}
                updateSessions={updateClientSessions}
                setSelectedSessionId={setSelectedSessionId}
                onSelectTrainer={(id) => {
                  setSelectedProfileTrainerId(id);
                  setView("trainer-profile");
                }}
                searchTerm={hubSearchTerm}
                onSearchTermChange={setHubSearchTerm}
              />
            )}
            {currentView === "machine-anatomy" && (
              <CatalogView machines={machines} authTrainer={authTrainer} />
            )}
            {currentView === "studio-tasks" && (
              <StudioTasksView
                authTrainer={authTrainer}
                clients={clients}
                onOpenClientTask={(clientId, action) => {
                  // A client task points at the screen where the work is
                  // actually done, rather than being a tick that claims it
                  // happened. 'inbody' has no screen of its own yet, so it
                  // lands on the profile — the closest honest destination.
                  setSelectedClientId(clientId);
                  setCurrentView(
                    action === "progress-report"
                      ? "progress-report"
                      : action === "assessment"
                        ? "consultation-wizard"
                        : "profile",
                  );
                }}
              />
            )}
            {currentView === "leaderboard" && (
              <MachineLeaderboardDashboard
                clients={clients}
                activeStudioId={activeStudioId}
                onBack={() => setCurrentView(leaderboardReturnView)}
              />
            )}
            {currentView === "machines" && (
              <MachinesView
                machines={machines}
                clients={clients}
                onOpenInfo={(m) => {
                  setInfoMachineId(m.id!);
                  setIsEditingMachineInfo(false);
                }}
              />
            )}
            {currentView === "workouts" && (
              <WorkoutTrackerView
                clientId={selectedClientId}
                clients={clients}
                machines={machines}
                schedules={schedules}
                trainers={trainers}
                user={user}
                setView={setView}
                setSelectedClientId={setSelectedClientId}
                showClientPicker={showClientPicker}
                setShowClientPicker={setShowClientPicker}
                onStartNewClientOnboarding={setNewClientOnboardingName}
                setClientFormData={setClientFormData}
                onOpenInfo={(m) => {
                  setInfoMachineId(m.id!);
                  setIsEditingMachineInfo(false);
                }}
                authTrainer={authTrainer}
                trainerFocuses={trainerFocuses}
                isSyncing={isSyncing}
                setIsSyncing={setIsSyncing}
                isIntroSession={isIntroSession}
                rightControls={headerRightControls}
                trainerDropdown={headerTrainerDropdown}
                onStudioClick={() => setIsChangingStudio(true)}
              />
            )}
            {currentView === "history" && (
              <ClientHistoryView
                clientId={selectedClientId}
                clients={clients}
                machines={machines}
                trainers={trainers}
                setView={setCurrentView}
                selectedSessionId={selectedSessionId}
                user={user}
              />
            )}
            {currentView === "profile" && (
              <ClientProfileView
                clientId={selectedClientId}
                isLoadingClient={isLoadingClient}
                clients={clients}
                machines={machines}
                authTrainer={authTrainer}
                trainers={trainers}
                onDelete={handleDeleteClient}
                onSelectReport={(reportId) => {
                  setSelectedReportId(reportId);
                  setView("progress-report");
                }}
                setView={setView}
                setSelectedClientId={setSelectedClientId}
                hasQuotaError={hasQuotaError}
                user={user}
                studios={studios}
                activeStudioId={activeStudioId}
              />
            )}
            {currentView === "clinical-review" &&
              selectedClientId &&
              authTrainer && (
                <ClientClinicalReviewPreloader
                  client={
                    clients.find((c) => c.id === selectedClientId) ||
                    ({} as Client)
                  }
                  machines={machines}
                  onOpenBriefing={() => {
                    setCurrentView("workouts");
                  }}
                  onClose={() => {
                    setCurrentView("profile");
                  }}
                />
              )}
            {currentView === "progress-report" &&
              selectedClientId &&
              authTrainer && (
                <ClientProgressReportView
                  client={
                    clients.find((c) => c.id === selectedClientId) ||
                    ({} as Client)
                  }
                  trainer={authTrainer}
                  machines={machines}
                  existingReportId={selectedReportId || undefined}
                  onBack={() => {
                    setSelectedReportId(null);
                    setCurrentView("profile");
                  }}
                />
              )}
            {currentView === "trainer-profile" &&
              (selectedProfileTrainerId
                ? trainers.find((t) => t.id === selectedProfileTrainerId)
                : authTrainer) && (
                <TrainerProfileView
                  trainer={
                    (selectedProfileTrainerId
                      ? trainers.find((t) => t.id === selectedProfileTrainerId)
                      : authTrainer)!
                  }
                  schedules={schedules}
                  sessions={sessions}
                  clients={clients}
                  studios={studios}
                  onSelectClient={setSelectedClientId}
                  setView={setCurrentView}
                  authTrainer={authTrainer}
                />
              )}
            {currentView === "franchise-dashboard" && authTrainer && (
              <FranchiseDashboardView
                authTrainer={authTrainer}
                allStudios={studios}
                allTrainers={trainers}
                networks={networks}
              />
            )}
            {currentView === "admin-dashboard" && authTrainer && (
              <AdminDashboardView
                authTrainer={authTrainer}
                studios={studios}
                networks={networks}
                trainers={trainers}
                isAdmin={isAdmin}
                onRefresh={handleManualRefresh}
                clients={clients}
                sessions={sessions}
                machines={machines}
                newClientsCount={newClientsThisMonth.length}
                onShowNewClients={() => setShowNewClientsDialog(true)}
                onUpdateStudio={updateStudio}
                onUpdateClient={updateClient}
                activeStudioId={activeStudioId}
                onSeedDemoClient={handleSeedDemoClient}
                onRestoreMachines={handleRestoreMachines}
                onReorderTrainers={() => setIsReorderingTrainers(true)}
                onAppCleanse={handleAppCleanse}
                onNavigateProfile={(clientId) => {
                  setSelectedClientId(clientId);
                  setCurrentView("profile");
                }}
              />
            )}
            {currentView === "trainer-hub" && (
              <TrainerSettingsView
                authTrainer={authTrainer}
                studios={studios}
                trainers={trainers}
                machines={machines}
                activeStudioId={activeStudioId}
                onLogout={handleLogout}
                setView={(view) => {
                  if (view === "leaderboard")
                    setLeaderboardReturnView("trainer-hub");
                  setCurrentView(view as any);
                }}
              />
            )}


            {currentView === "calendar" && (
              <ErrorBoundary
                fallback={
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                      <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">
                      Schedule Unavailable
                    </h3>
                    <p className="text-muted-foreground max-w-sm mb-6">
                      The schedule grid encountered an error. You can still
                      access client metrics and profiles.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => window.location.reload()}
                    >
                      Reload Dashboard
                    </Button>
                  </div>
                }
              >
                <CalendarView
                  schedules={schedules}
                  trainers={trainers}
                  authTrainer={authTrainer}
                  isAdmin={
                    tokenRole === "Admin" ||
                    authTrainer?.role === "Admin" ||
                    tokenRole === "Founder" ||
                    authTrainer?.role === "Founder"
                  }
                  activeStudioId={activeStudioId}
                  onSelectClient={setSelectedClientId}
                  onStartNewClientOnboarding={setNewClientOnboardingName}
                  setView={setView}
                  clients={clients}
                />
              </ErrorBoundary>
            )}
            {currentView === "purchases" && <PurchaseView />}
            {currentView === "chart-importer" && (
              <LegacyChartImporter
                clients={clients}
                machines={machines}
                trainers={trainers}
                initialClientId={selectedClientId || undefined}
                onComplete={() => {
                  if (selectedClientId) setCurrentView("profile");
                  else setCurrentView("clients");
                }}
              />
            )}
          </AnimatePresence>
          </Suspense>
        </main>

        {/* Navigation Bar */}
        {appMode === "trainer" ? (
          <nav className="flex-none bg-white dark:bg-bg-dark border-t border-[#68717A]/20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] px-2 sm:px-6 min-h-14 sm:min-h-20 pb-[env(safe-area-inset-bottom,0px)] flex items-center justify-around z-30">
            <NavButton
              active={currentView === "clients"}
              onClick={() => setCurrentView("clients")}
              icon={<Users className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="Hub"
            />
            <NavButton
              active={[
                "profile",
                "history",
                "progress-report",
                "client-directory",
              ].includes(currentView)}
              onClick={() => {
                if (selectedClientId) {
                  setCurrentView("profile");
                } else {
                  setCurrentView("client-directory");
                }
              }}
              icon={<ClipboardList className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="Client"
            />
            <NavButton
              active={currentView === "workouts"}
              onClick={() => {
                if (currentSession || selectedClientId) {
                  setCurrentView("workouts");
                } else {
                  setCurrentView("client-directory");
                }
              }}
              icon={<PlayCircle className="w-5 h-5 sm:w-6 sm:h-6" />}
              label={currentSession ? "Active Session" : "Start Session"}
              activeColor={currentSession ? "text-orange-500" : undefined}
              activeBg={
                currentSession
                  ? "bg-orange-500/10 dark:bg-orange-600/10"
                  : undefined
              }
              activeIndicator={
                currentSession ? "bg-orange-500 dark:bg-orange-600" : undefined
              }
            />
            <NavButton
              active={currentView === "machine-anatomy"}
              onClick={() => setCurrentView("machine-anatomy")}
              icon={<Dumbbell className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="Catalog"
            />
            <NavButton
              active={currentView === "studio-tasks"}
              onClick={() => setCurrentView("studio-tasks")}
              icon={<ListChecks className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="To-Do"
            />
            <NavButton
              active={currentView === "calendar"}
              onClick={() => setCurrentView("calendar")}
              icon={<Calendar className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="Calendar"
            />
          </nav>
        ) : (
          <nav className="flex-none bg-white dark:bg-bg-dark border-t border-orange-500/20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] px-2 sm:px-6 min-h-14 sm:min-h-20 pb-[env(safe-area-inset-bottom,0px)] flex items-center justify-around z-30">
            <NavButton
              active={currentView === "admin-dashboard"}
              onClick={() => setCurrentView("admin-dashboard" as any)}
              icon={<LayoutDashboard className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="Admin"
              activeColor="text-orange-500"
              activeBg="bg-orange-500/10 dark:bg-orange-600/10"
              activeIndicator="bg-orange-500 dark:bg-orange-600"
            />
            {(isOwner(authTrainer) ||
              checkIsAdmin(authTrainer, user.email || undefined)) && (
              <NavButton
                active={currentView === "franchise-dashboard"}
                onClick={() => setCurrentView("franchise-dashboard" as any)}
                icon={<Network className="w-5 h-5 sm:w-6 sm:h-6" />}
                label="Franchise"
                activeColor="text-indigo-500"
                activeBg="bg-indigo-500/10 dark:bg-indigo-600/10"
                activeIndicator="bg-indigo-500 dark:bg-indigo-600"
              />
            )}
            <NavButton
              active={currentView === "trainer-hub"}
              onClick={() => setCurrentView("trainer-hub")}
              icon={<Settings className="w-5 h-5 sm:w-6 sm:h-6" />}
              label="Customize Studio"
              activeColor="text-emerald-500"
              activeBg="bg-emerald-500/10 dark:bg-emerald-600/10"
              activeIndicator="bg-emerald-500 dark:bg-emerald-600"
            />
          </nav>
        )}
      </div>

      {/* Machine Information Deep Dive Dialog */}
      <Dialog
        open={!!infoMachineId}
        onOpenChange={(open) => !open && setInfoMachineId(null)}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-[32px] p-0 border-none shadow-2xl dark:shadow-none">
          {infoMachine && (
            <>
              <DialogHeader className="p-8 bg-white dark:bg-bg-dark border-b relative">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center font-black text-xl text-primary shadow-sm dark:shadow-none">
                    {infoMachine.order}
                  </div>
                  <div>
                    <DialogTitle className="text-3xl font-black uppercase italic tracking-tighter">
                      {infoMachine.fullName || infoMachine.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                      Deep Dive & Operational Guidelines
                    </DialogDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-6 right-6 h-10 w-10 rounded-xl"
                  onClick={() => setIsEditingMachineInfo(!isEditingMachineInfo)}
                >
                  <Edit3 className="w-5 h-5" />
                </Button>
              </DialogHeader>

              <div className="p-8 space-y-8">
                {isEditingMachineInfo ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                          Target Muscles
                        </Label>
                        <Input
                          value={machineInfoDraft.targetMuscles || ""}
                          onChange={(e) =>
                            setMachineInfoDraft({
                              ...machineInfoDraft,
                              targetMuscles: e.target.value,
                            })
                          }
                          placeholder="e.g. Chest, Triceps"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                          Form Video URL
                        </Label>
                        <Input
                          value={machineInfoDraft.formVideoUrl || ""}
                          onChange={(e) =>
                            setMachineInfoDraft({
                              ...machineInfoDraft,
                              formVideoUrl: e.target.value,
                            })
                          }
                          placeholder="Youtube/Vimeo Link"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                        Standard Machine Settings (Tips)
                      </Label>
                      <Textarea
                        value={machineInfoDraft.settings || ""}
                        onChange={(e) =>
                          setMachineInfoDraft({
                            ...machineInfoDraft,
                            settings: e.target.value,
                          })
                        }
                        placeholder="Recommended starting points for different heights/sizes..."
                        className="min-h-20"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                        Cueing Tips (Trainer to Trainer)
                      </Label>
                      <Textarea
                        value={machineInfoDraft.cueingTips || ""}
                        onChange={(e) =>
                          setMachineInfoDraft({
                            ...machineInfoDraft,
                            cueingTips: e.target.value,
                          })
                        }
                        placeholder="Pointers for better client form..."
                        className="min-h-25"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                        Deep Dive Notes
                      </Label>
                      <Textarea
                        value={machineInfoDraft.deepDiveNotes || ""}
                        onChange={(e) =>
                          setMachineInfoDraft({
                            ...machineInfoDraft,
                            deepDiveNotes: e.target.value,
                          })
                        }
                        placeholder="History, benefits, or complex cues..."
                        className="min-h-37.5"
                      />
                    </div>

                    <div className="flex gap-3">
                      <Button
                        className="flex-1 h-12 rounded-xl font-black uppercase italic tracking-widest"
                        onClick={async () => {
                          try {
                            await updateDoc(
                              doc(db, "machines", infoMachine.id!),
                              {
                                ...machineInfoDraft,
                                updatedAt: serverTimestamp(),
                              },
                            );
                            setIsEditingMachineInfo(false);
                          } catch (err) {
                            handleFirestoreError(
                              err,
                              OperationType.UPDATE,
                              "machines",
                            );
                          }
                        }}
                      >
                        Save Information
                      </Button>
                      <Button
                        variant="outline"
                        className="h-12 px-6 rounded-xl"
                        onClick={() => setIsEditingMachineInfo(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-8">
                    {/* Visual & Core Info Header */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="aspect-video bg-muted rounded-2xl overflow-hidden relative flex items-center justify-center border border-border group">
                        {infoMachine.imageUrl ? (
                          <img
                            src={infoMachine.imageUrl}
                            className="w-full h-full object-cover brightness-100 transition-all duration-500"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=800&q=80";
                            }}
                          />
                        ) : (
                          // Unsplash default photo mechanism for robust mockups
                          <img
                            src={getMachineImageUrl(infoMachine.id)}
                            className="w-full h-full object-cover brightness-100 transition-all duration-500"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "https://images.unsplash.com/photo-1540497077202-7c8a3999166f?auto=format&fit=crop&w=800&q=80";
                            }}
                          />
                        )}
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end z-10">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-widest text-orange-500 mb-1">
                              Targeted Muscles
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {infoMachine.targetMuscles
                                ?.split(",")
                                .map((m) => (
                                  <Badge
                                    key={m}
                                    className="bg-primary/90 text-primary-foreground border-none font-medium uppercase text-[11px] px-2 py-0.5"
                                  >
                                    {m.trim()}
                                  </Badge>
                                )) || (
                                <Badge className="bg-primary/90 text-primary-foreground border-none font-medium uppercase text-[11px] px-2 py-0.5">
                                  Primary Target Area
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 flex flex-col justify-center">
                        <div className="bg-primary/5 rounded-2xl p-6 border border-primary/10">
                          <h3 className="text-sm font-bold uppercase tracking-tight text-primary mb-2">
                            Resource Actions
                          </h3>
                          <div className="space-y-3">
                            <Button className="w-full justify-start h-12 rounded-xl bg-background border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                              <Play className="w-4 h-4 mr-3" />
                              <span className="font-bold text-[11px] uppercase tracking-widest">
                                View Form Guide Video
                              </span>
                            </Button>
                            <Button
                              variant="outline"
                              className="w-full justify-start h-12 rounded-xl font-bold text-[11px] uppercase tracking-widest text-secondary hover:bg-secondary hover:text-secondary-foreground transition-all"
                            >
                              <MessageSquare className="w-4 h-4 mr-3" />
                              Send Resource to Client
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Machine Insights Section (Orange Application) */}
                    <div className="bg-action/5 border border-action/20 rounded-2xl p-6 md:p-8">
                      <h3 className="text-xl font-bold uppercase tracking-tight text-action mb-6 flex items-center gap-2">
                        <TrendingUp className="w-6 h-6" />
                        Machine Insights & Demographics
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Demographic 1 */}
                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <div>
                              <p className="text-[12px] font-bold text-secondary">
                                Age 20-30
                              </p>
                              <p className="text-[11px] font-medium text-secondary/60 uppercase tracking-widest">
                                Female | Beginner
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <div className="flex justify-between text-[11px] font-bold text-secondary mb-1">
                                <span>Average Weight (45 lbs)</span>
                                <span className="text-action">SD ±5</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-action w-[45%]" />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-[11px] font-bold text-secondary mb-1">
                                <span>Average Reps (12)</span>
                                <span className="text-action">SD ±2</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-action/60 w-[60%]" />
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Demographic 2 */}
                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <div>
                              <p className="text-[12px] font-bold text-secondary">
                                Age 30-40
                              </p>
                              <p className="text-[11px] font-medium text-secondary/60 uppercase tracking-widest">
                                Male | Advanced
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <div className="flex justify-between text-[11px] font-bold text-secondary mb-1">
                                <span>Average Weight (120 lbs)</span>
                                <span className="text-primary">SD ±15</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary w-[85%]" />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-[11px] font-bold text-secondary mb-1">
                                <span>Average Reps (8)</span>
                                <span className="text-primary">SD ±1.5</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary/60 w-[40%]" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Trainer Cues and Tips */}
                      <div className="space-y-4">
                        <h4 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-primary mb-4">
                          <Users className="w-4 h-4" />
                          Trainer Cues & Tips
                        </h4>

                        <div className="space-y-3">
                          {/* Simulated Collapsible Cards */}
                          <div className="border border-border rounded-xl p-4 hover:bg-white dark:bg-bg-dark transition-colors cursor-pointer group">
                            <div className="flex justify-between items-center">
                              <p className="text-[12px] font-bold text-secondary">
                                Marina's Cue
                              </p>
                              <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                              "Keep your chest proud and drive through the
                              mid-foot rather than the toes."
                            </p>
                          </div>
                          <div className="border border-border rounded-xl p-4 hover:bg-white dark:bg-bg-dark transition-colors cursor-pointer group">
                            <div className="flex justify-between items-center">
                              <p className="text-[12px] font-bold text-secondary">
                                Christian's Cue
                              </p>
                              <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                              "Imagine retracting your shoulder blades
                              completely before pulling the weight down."
                            </p>
                          </div>
                          <div className="border border-border rounded-xl p-4 hover:bg-white dark:bg-bg-dark transition-colors cursor-pointer group">
                            <div className="flex justify-between items-center">
                              <p className="text-[12px] font-bold text-secondary">
                                Austin's Cue
                              </p>
                              <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                              "Focus on the eccentric phase; count to three as
                              you release the tension."
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Common Mistakes & Setup */}
                      <div className="space-y-4">
                        <h4 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-secondary mb-4">
                          <AlertCircle className="w-4 h-4" />
                          Critical Setup Deviations
                        </h4>
                        <div className="bg-white dark:bg-bg-dark rounded-2xl p-6 border border-border">
                          <ul className="space-y-4">
                            <li className="space-y-2">
                              <div className="flex justify-between">
                                <p className="text-[11px] font-bold text-secondary">
                                  Seat Too High
                                </p>
                                <span className="text-[11px] font-bold text-action">
                                  High Risk
                                </span>
                              </div>
                              <div className="h-1.5 bg-background rounded-full overflow-hidden">
                                <div className="h-full bg-action w-[75%]" />
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Places extreme stress on the lower back during
                                extension.
                              </p>
                            </li>
                            <li className="space-y-2">
                              <div className="flex justify-between">
                                <p className="text-[11px] font-bold text-secondary">
                                  Incomplete Range of Motion
                                </p>
                                <span className="text-[11px] font-bold text-amber-500">
                                  Medium Risk
                                </span>
                              </div>
                              <div className="h-1.5 bg-background rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 w-[45%]" />
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Failing to fully lock out or fully stretch at
                                the bottom.
                              </p>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Deep Dive Notes */}
                    <div className="space-y-4">
                      <h4 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-secondary mb-2">
                        <StickyNote className="w-4 h-4" />
                        Deep Dive Notes
                      </h4>
                      <div className="p-4 bg-background border border-border rounded-xl min-h-25">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {infoMachine.deepDiveNotes ||
                            "Enter detailed clinical observations and biomechanical notes here..."}
                        </p>
                      </div>
                    </div>

                    {/* Log Session Action */}
                    <div className="pt-4 border-t border-border flex justify-end">
                      <Button className="bg-action hover:bg-action/90 text-action-foreground font-bold uppercase tracking-widest text-[11px] h-12 px-8 rounded-xl shadow-lg shadow-action/20">
                        <Plus className="w-4 h-4 mr-2" />
                        Log Session / Add Data Points
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New Clients Dialog */}
      <Dialog
        open={showNewClientsDialog}
        onOpenChange={setShowNewClientsDialog}
      >
        <DialogContent className="max-w-2xl rounded-[32px] p-0 overflow-hidden border-none shadow-2xl dark:shadow-none">
          <DialogHeader className="p-8 bg-primary/5 border-b border-primary/10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-2xl">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black uppercase italic tracking-tighter">
                  New Clients Dashboard
                </DialogTitle>
                <DialogDescription className="text-[11px] font-black uppercase tracking-widest text-primary/60">
                  Registered in{" "}
                  {new Date().toLocaleDateString([], {
                    month: "long",
                    year: "numeric",
                  })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            {newClientsThisMonth.length > 0 ? (
              <div className="grid gap-3">
                {newClientsThisMonth.map((client) => (
                  <div
                    key={client.id}
                    onClick={() => {
                      setSelectedClientId(client.id!);
                      setCurrentView("profile");
                      setShowNewClientsDialog(false);
                    }}
                    className="flex items-center justify-between p-4 bg-white dark:bg-bg-dark rounded-2xl border border-transparent hover:border-primary/20 hover:bg-white transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center font-black text-primary border shadow-sm dark:shadow-none group-hover:scale-110 transition-transform">
                        {(client.firstName || "?")[0] || "?"}
                        {(client.lastName || "")[0] || ""}
                      </div>
                      <div>
                        <p className="font-black uppercase tracking-tight text-sm">
                          {client.firstName} {client.lastName}
                        </p>
                        <p className="text-[11px] font-bold text-muted-foreground uppercase">
                          {client.occupation || "No occupation listed"}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center">
                <Users className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                <p className="text-xs font-black uppercase text-muted-foreground">
                  No new clients registered this month.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="p-6 bg-white dark:bg-bg-dark border-t">
            <Button
              onClick={() => setShowNewClientsDialog(false)}
              className="rounded-xl font-bold uppercase tracking-widest w-full h-12"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trainer Reordering Dialog */}
      <Dialog
        open={isReorderingTrainers}
        onOpenChange={setIsReorderingTrainers}
      >
        <DialogContent className="max-w-md rounded-[32px] p-0 overflow-hidden border-none shadow-2xl dark:shadow-none max-h-[85vh] flex flex-col">
          <DialogHeader className="p-8 bg-white dark:bg-bg-dark border-b shrink-0">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-2xl">
                <GripVertical className="w-6 h-6 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black uppercase italic tracking-tighter">
                  Team Presence Sorting
                </DialogTitle>
                <DialogDescription className="text-[11px] font-bold text-muted-foreground uppercase">
                  Organize how trainers appear in the hub grid.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="p-6 space-y-3 flex-1 overflow-y-auto custom-scrollbar">
            {sortedTrainers
              .filter(
                (t) =>
                  !activeStudioId ||
                  t.primaryHomeStudioId === activeStudioId ||
                  t.accessibleStudioIds?.includes(activeStudioId) ||
                  t.activeGuestStudioIds?.includes(activeStudioId),
              )
              .map((trainer, idx, studioTrainers) => (
                <div
                  key={trainer.id}
                  className="flex items-center gap-4 p-4 bg-white dark:bg-bg-dark rounded-2xl border border-border/50 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-background border flex items-center justify-center font-black text-xs text-muted-foreground">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="font-black uppercase tracking-tighter text-sm">
                      {trainer.fullName}
                    </p>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase italic">
                      {trainer.initials}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={idx === 0}
                      className="h-8 w-8 rounded-lg hover:bg-primary/10 hover:text-primary disabled:opacity-20"
                      onClick={async () => {
                        const newSorted = [...studioTrainers];
                        [newSorted[idx], newSorted[idx - 1]] = [
                          newSorted[idx - 1],
                          newSorted[idx],
                        ];
                        for (let i = 0; i < newSorted.length; i++) {
                          if (newSorted[i].id) {
                            await updateDoc(
                              doc(db, "trainers", newSorted[i].id!),
                              { order: i },
                            );
                          }
                        }
                      }}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={idx === studioTrainers.length - 1}
                      className="h-8 w-8 rounded-lg hover:bg-primary/10 hover:text-primary disabled:opacity-20"
                      onClick={async () => {
                        const newSorted = [...studioTrainers];
                        [newSorted[idx], newSorted[idx + 1]] = [
                          newSorted[idx + 1],
                          newSorted[idx],
                        ];
                        for (let i = 0; i < newSorted.length; i++) {
                          if (newSorted[i].id) {
                            await updateDoc(
                              doc(db, "trainers", newSorted[i].id!),
                              { order: i },
                            );
                          }
                        }
                      }}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
          <DialogFooter className="p-6 border-t bg-white dark:bg-bg-dark shrink-0">
            <Button
              onClick={() => setIsReorderingTrainers(false)}
              className="rounded-xl font-bold uppercase tracking-widest w-full h-12"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StrongConfirmationModal
        isOpen={isWipeModalOpen}
        title="Wipe Entire Database"
        description="This critical action will permanently delete all Clients, Trainers, Sessions, Schedules, Notes, and Logs. It will then completely re-initialize the 20 standard machines to factory defaults. This cannot be undone."
        confirmationPhrase="confirm wipe system"
        onConfirm={executeAppCleanse}
        onCancel={() => setIsWipeModalOpen(false)}
        isDestructive={true}
      />
      </FeedbackProvider>
    </ErrorBoundary>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  activeColor = "text-[#115E8D]",
  activeBg = "bg-sky-500 dark:bg-sky-600/10",
  activeIndicator = "bg-sky-500 dark:bg-sky-600",
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeColor?: string;
  activeBg?: string;
  activeIndicator?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 transition-all duration-300 relative ${active ? `${activeColor} scale-105` : "text-[#68717A] hover:text-[#115E8D]"}`}
    >
      <div
        className={`p-1 sm:p-1.5 rounded-lg transition-colors ${active ? activeBg : "bg-transparent"}`}
      >
        {icon}
      </div>
      <span className="text-[9px] sm:text-[11px] font-black uppercase tracking-tighter">
        {label}
      </span>
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className={`absolute -bottom-1 left-0 right-0 h-0.5 rounded-full ${activeIndicator}`}
        />
      )}
    </button>
  );
}

const DEFAULT_AVAILABILITY: TrainerAvailability = {
  standard: {
    Monday: {
      isOpen: true,
      slots: [
        { start: "07:00", end: "12:30" },
        { start: "15:00", end: "18:30" },
      ],
    },
    Tuesday: {
      isOpen: true,
      slots: [
        { start: "07:00", end: "12:30" },
        { start: "15:00", end: "18:30" },
      ],
    },
    Wednesday: { isOpen: true, slots: [{ start: "07:00", end: "12:30" }] },
    Thursday: {
      isOpen: true,
      slots: [
        { start: "07:00", end: "12:30" },
        { start: "15:00", end: "18:30" },
      ],
    },
    Friday: { isOpen: true, slots: [{ start: "07:00", end: "12:30" }] },
    Saturday: { isOpen: true, slots: [{ start: "07:00", end: "12:30" }] },
    Sunday: { isOpen: false, slots: [] },
  },
};
