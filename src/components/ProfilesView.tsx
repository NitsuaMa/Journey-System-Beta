import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Users,
  UserCircle,
  Search,
  ArrowUpDown,
  Calendar,
  Clock,
  TrendingUp,
  ChevronRight,
  ChevronLeft,
  CalendarDays,
  Activity,
  History,
  Timer,
  MoreVertical,
  Settings,
  Mail,
  Phone,
  Briefcase,
  Plus,
  Trash2,
  RefreshCcw,
  Link as LinkIcon,
  Loader2,
  Database,
} from "lucide-react";
import { doc, updateDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn, parseSessionDate } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import { StrongConfirmationModal } from "./StrongConfirmationModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trainer, Client, WorkoutSession, ScheduleEntry, View } from "../types";
import { generateMockClientWithHistory } from "../lib/mockDataGenerator";

interface ProfilesViewProps {
  trainers: Trainer[];
  clients: Client[];
  sessions: WorkoutSession[];
  schedules: ScheduleEntry[];
  onSelectClient: (id: string) => void;
  setView: (v: View) => void;
  setSelectedClientId: (id: string | null) => void;
  authTrainer: Trainer | null;
  onTrainerLogin?: (trainer: Trainer) => void;
  /**
   * Open a trainer's full profile. Available to every trainer, not just
   * admins -- the profile itself decides what a given viewer may see (see
   * features/trainer-profile/visibility.ts), so gating the door as well would
   * only mean nobody could ever look up a colleague's certifications.
   */
  onViewTrainerProfile?: (trainerId: string) => void;
  isAdmin: boolean;
}

type SortOption = "recent" | "new" | "upcoming";

export function ProfilesView({
  trainers,
  clients,
  sessions,
  schedules,
  onSelectClient,
  setView,
  setSelectedClientId,
  authTrainer,
  onTrainerLogin,
  onViewTrainerProfile,
  isAdmin,
}: ProfilesViewProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("recent");
  const [activeProfile, setActiveProfile] = useState<{
    type: "trainer" | "client";
    id: string;
  } | null>(null);

  // Link Edit State
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [isSavingLink, setIsSavingLink] = useState(false);

  const [isGeneratingMock, setIsGeneratingMock] = useState(false);
  const [isDeletingTrainer, setIsDeletingTrainer] = useState<string | null>(
    null,
  );
  const [trainerToDeleteObj, setTrainerToDeleteObj] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showMockConfirm, setShowMockConfirm] = useState(false);

  const handleDeleteTrainer = async (
    trainerId: string,
    trainerName: string,
  ) => {
    if (!isAdmin) return;
    setTrainerToDeleteObj({ id: trainerId, name: trainerName });
  };

  const performDeleteTrainer = async () => {
    if (!trainerToDeleteObj) return;
    setIsDeletingTrainer(trainerToDeleteObj.id);
    try {
      await deleteDoc(doc(db, "trainers", trainerToDeleteObj.id));
      toastSuccess(`Trainer ${trainerToDeleteObj.name} deleted successfully.`);
    } catch (err: any) {
      toastError("Failed to delete trainer: " + err.message);
    } finally {
      setIsDeletingTrainer(null);
      setTrainerToDeleteObj(null);
    }
  };

  const handleGenerateMock = async () => {
    if (!authTrainer) {
      toastError("Please login as a trainer first.");
      return;
    }
    setShowMockConfirm(true);
  };

  const performGenerateMock = async () => {
    if (!authTrainer) return;
    setIsGeneratingMock(true);
    try {
      const { clientId, clientName } = await generateMockClientWithHistory(
        authTrainer.id!,
        authTrainer.initials,
      );
      toastSuccess(
        `Success! Generated client "${clientName}". Redirecting to profile...`,
      );
      onSelectClient(clientId);
    } catch (err: any) {
      toastError("Generation failed: " + err.message);
    } finally {
      setIsGeneratingMock(false);
      setShowMockConfirm(false);
    }
  };

  // Sorting calculations
  const sortedClients = useMemo(() => {
    const clientsWithMetrics = clients.map((client) => {
      const clientSessions = sessions.filter((s) => s.clientId === client.id);
      const lastSession = clientSessions.sort(
        (a, b) => parseSessionDate(b.date) - parseSessionDate(a.date),
      )[0];
      const lastSessionTime = lastSession
        ? parseSessionDate(lastSession.date)
        : 0;

      const clientSchedules = schedules.filter(
        (s) => s.clientId === client.id && s.status === "Scheduled",
      );
      const nextSession = clientSchedules.sort(
        (a, b) =>
          a.startTime.toDate().getTime() - b.startTime.toDate().getTime(),
      )[0];
      const nextSessionTime = nextSession
        ? nextSession.startTime.toDate().getTime()
        : Infinity;

      const createdAtTime =
        client.createdAt?.toDate?.()?.getTime() ||
        (client.createdAt ? new Date(client.createdAt).getTime() : 0);

      return {
        ...client,
        lastSessionTime,
        nextSessionTime,
        createdAtTime,
      };
    });

    let sorted = [...clientsWithMetrics];

    if (sortOption === "recent") {
      sorted.sort((a, b) => b.lastSessionTime - a.lastSessionTime);
    } else if (sortOption === "new") {
      sorted.sort((a, b) => b.createdAtTime - a.createdAtTime);
    } else if (sortOption === "upcoming") {
      sorted.sort((a, b) => a.nextSessionTime - b.nextSessionTime);
    }

    if (searchTerm) {
      sorted = sorted.filter((c) =>
        `${c.firstName} ${c.lastName}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase()),
      );
    }

    return sorted;
  }, [clients, sessions, schedules, sortOption, searchTerm]);

  const filteredTrainers = trainers.filter(
    (t) =>
      t.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.initials.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleProfileClick = (type: "trainer" | "client", id: string) => {
    setActiveProfile({ type, id });
  };

  const handleBackToList = () => {
    setActiveProfile(null);
  };

  // Handle profile click side effects
  React.useEffect(() => {
    if (activeProfile?.type === "client") {
      setSelectedClientId(activeProfile.id);
      setView("profile");
      setActiveProfile(null);
    }
  }, [activeProfile, setSelectedClientId, setView]);

  const trainer = useMemo(() => {
    if (activeProfile?.type !== "trainer") return null;
    return trainers.find((t) => t.id === activeProfile.id);
  }, [activeProfile, trainers]);

  const trainerData = useMemo(() => {
    if (!trainer) return null;
    const trainerSessions = sessions.filter(
      (s) => s.trainerInitials === trainer.initials,
    );
    const trainerSchedules = schedules
      .filter(
        (s) =>
          (s.trainerId === trainer.id ||
            s.trainerName
              .toLowerCase()
              .includes(trainer.fullName.toLowerCase())) &&
          s.status === "Scheduled",
      )
      .sort(
        (a, b) =>
          a.startTime.toDate().getTime() - b.startTime.toDate().getTime(),
      );
    return { trainerSessions, trainerSchedules };
  }, [trainer, sessions, schedules]);

  if (activeProfile?.type === "client") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-32 w-full max-w-full overflow-x-hidden"
    >
      <AnimatePresence mode="wait">
        {activeProfile?.type === "trainer" && trainer ? (
          <motion.div
            key="trainer-detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBackToList}
                className="rounded-full"
              >
                <ChevronLeft className="w-6 h-6" />
              </Button>
              <h2 className="text-3xl font-black uppercase italic tracking-tighter">
                Trainer Profile
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <Card className="lg:col-span-4 rounded-[32px] border-2 shadow-2xl overflow-hidden h-fit">
                <div className="bg-primary/5 p-8 flex flex-col items-center text-center space-y-4">
                  <div className="w-24 h-24 rounded-[32px] bg-primary flex items-center justify-center text-white text-4xl font-black shadow-xl shadow-primary/20">
                    {trainer.initials}
                  </div>
                  <div>
                    <h3 className="text-2xl font-black uppercase italic tracking-tight leading-none">
                      {trainer.fullName}
                    </h3>
                    <p className="text-[11px] font-black uppercase text-primary tracking-widest mt-2 px-3 py-1 bg-primary/10 rounded-full inline-block">
                      Professional Trainer
                    </p>
                  </div>
                </div>
                <CardContent className="p-6 space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/30">
                      <Briefcase className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <p className="text-[11px] font-black uppercase text-muted-foreground tracking-widest">
                          Team Role
                        </p>
                        <p className="text-sm font-bold uppercase">
                          HIT Specialist
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-muted/30">
                      <Settings className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <p className="text-[11px] font-black uppercase text-muted-foreground tracking-widest">
                          Legacy ID
                        </p>
                        <p className="text-sm font-bold uppercase">
                          {trainer.legacy_filemaker_id || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 text-center">
                      <p className="text-[11px] font-black uppercase text-muted-foreground mb-1">
                        Sessions
                      </p>
                      <p className="text-2xl font-black text-primary">
                        {trainerData?.trainerSessions.length || 0}
                      </p>
                    </div>
                    <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 text-center">
                      <p className="text-[11px] font-black uppercase text-muted-foreground mb-1">
                        Upcoming
                      </p>
                      <p className="text-2xl font-black text-indigo-600">
                        {trainerData?.trainerSchedules.length || 0}
                      </p>
                    </div>
                  </div>

                  {/* MindBody Link Section */}
                  {(isAdmin || authTrainer?.id === trainer.id) && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <RefreshCcw className="w-4 h-4 text-primary" />
                          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                            MindBody Sync
                          </p>
                        </div>
                        {!isEditingLink && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-[11px] font-black uppercase tracking-widest"
                            onClick={() => {
                              setIsEditingLink(true);
                              setNewLinkUrl(trainer.mindbody_ical_url || "");
                            }}
                          >
                            {trainer.mindbody_ical_url
                              ? "Update Link"
                              : "Add Link"}
                          </Button>
                        )}
                      </div>

                      {isEditingLink ? (
                        <div className="space-y-2">
                          <Input
                            value={newLinkUrl}
                            onChange={(e) => setNewLinkUrl(e.target.value)}
                            placeholder="https://mindbody.com/export/..."
                            className="h-10 rounded-xl text-xs"
                          />
                          <div className="flex gap-2">
                            <Button
                              className="grow h-10 rounded-xl font-black uppercase text-[11px] tracking-widest"
                              onClick={async () => {
                                if (!trainer.id) return;
                                setIsSavingLink(true);
                                try {
                                  await updateDoc(
                                    doc(db, "trainers", trainer.id),
                                    {
                                      mindbody_ical_url: newLinkUrl,
                                      updatedAt: serverTimestamp(),
                                    },
                                  );
                                  setIsEditingLink(false);
                                  toastSuccess(
                                    "iCal Link updated successfully.",
                                  );
                                } catch (err: any) {
                                  toastError(
                                    "Failed to save link: " + err.message,
                                  );
                                } finally {
                                  setIsSavingLink(false);
                                }
                              }}
                              disabled={isSavingLink}
                            >
                              {isSavingLink ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                "Save Link"
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              className="h-10 rounded-xl font-black uppercase text-[11px] tracking-widest"
                              onClick={() => setIsEditingLink(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-2xl bg-muted/30 flex items-center gap-3 overflow-hidden">
                          <LinkIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-[11px] font-medium text-muted-foreground truncate">
                            {trainer.mindbody_ical_url ||
                              "No synchronization link setup"}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {onViewTrainerProfile && trainer.id && (
                    <Button
                      variant="outline"
                      className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px]"
                      onClick={() => {
                        onViewTrainerProfile(trainer.id);
                        setActiveProfile(null);
                      }}
                    >
                      <UserCircle className="w-4 h-4 mr-2" />
                      View Full Profile
                    </Button>
                  )}

                  {authTrainer?.id === trainer.id && (
                    <Button
                      variant="outline"
                      className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[11px]"
                      onClick={() => setView("trainer-hub")}
                    >
                      Go to Trainer Settings
                    </Button>
                  )}

                  {onTrainerLogin && authTrainer?.id !== trainer.id && (
                    <Button
                      className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-200 border-none group relative overflow-hidden"
                      onClick={() => {
                        onTrainerLogin(trainer);
                        setActiveProfile(null);
                        setView("clients");
                      }}
                    >
                      <motion.div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-500 ease-in-out" />
                      <RefreshCcw className="w-4 h-4 mr-2" />
                      Switch to this Profile
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-8 rounded-[32px] border-2 shadow-2xl overflow-hidden bg-muted/5 flex flex-col">
                <CardHeader className="bg-card border-b p-6">
                  <CardTitle className="text-xl font-black uppercase italic">
                    Upcoming Schedule
                  </CardTitle>
                  <CardDescription className="text-xs uppercase font-bold text-muted-foreground">
                    Synchronized with MindBody database
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 overflow-y-auto max-h-150 flex-1 custom-scrollbar">
                  {trainerData && trainerData.trainerSchedules.length > 0 ? (
                    <div className="space-y-3">
                      {trainerData.trainerSchedules.map((s, i) => (
                        <div
                          key={i}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 bg-card rounded-2xl border-2 border-transparent hover:border-primary/20 hover:shadow-xl transition-all group"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-muted/50 flex flex-col items-center justify-center shrink-0">
                              <span className="text-[11px] font-black text-muted-foreground leading-none">
                                {s.startTime
                                  .toDate()
                                  .toLocaleDateString([], { month: "short" })}
                              </span>
                              <span className="text-lg font-black leading-none">
                                {s.startTime.toDate().getDate()}
                              </span>
                            </div>
                            <div>
                              <p className="font-black uppercase tracking-tight text-lg leading-none group-hover:text-primary transition-colors">
                                {s.clientName}
                              </p>
                              <p className="text-[11px] font-bold text-muted-foreground uppercase mt-1 tracking-widest">
                                {s.serviceName}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 sm:mt-0 flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-sm font-black uppercase leading-none">
                                {s.startTime.toDate().toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                              <Badge
                                variant="outline"
                                className="text-[11px] font-black uppercase mt-1"
                              >
                                Confirmed
                              </Badge>
                            </div>
                            <ChevronRight className="w-5 h-5 opacity-20 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-20 text-center flex flex-col items-center gap-4">
                      <CalendarDays className="w-16 h-16 text-muted-foreground/10" />
                      <p className="text-sm font-bold text-muted-foreground uppercase">
                        No upcoming sessions found
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="profiles-list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-8"
          >
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6">
              <div>
                <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tighter leading-none">
                  Studio Profiles
                </h2>
                <p className="text-[11px] sm:text-[11px] font-black uppercase text-muted-foreground tracking-[0.2em] opacity-60 mt-2 leading-none">
                  Team & Client Operations Directory
                </p>
              </div>
              <div className="w-full md:w-96 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search team or clients..."
                  className="h-14 sm:h-16 pl-12 sm:pl-14 rounded-full border-2 border-muted focus:border-primary transition-all font-bold text-base sm:text-lg"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* Trainers Section */}
            <section className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="text-xl font-black uppercase italic tracking-tight">
                    Trainer Roster
                  </h3>
                </div>

                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl font-black uppercase text-[11px] tracking-widest gap-2 bg-amber-500/5 border-amber-500/20 text-amber-600 hover:bg-amber-500/10"
                    onClick={handleGenerateMock}
                    disabled={isGeneratingMock}
                  >
                    {isGeneratingMock ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Database className="w-3.5 h-3.5" />
                    )}
                    {isGeneratingMock
                      ? "Generating..."
                      : "Generate Mock Client"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {filteredTrainers.map((trainerItem) => {
                  const upcCount = schedules.filter(
                    (s) =>
                      (s.trainerId === trainerItem.id ||
                        s.trainerName
                          .toLowerCase()
                          .includes(trainerItem.fullName.toLowerCase())) &&
                      s.status === "Scheduled",
                  ).length;

                  return (
                    <motion.div
                      key={trainerItem.id}
                      whileHover={{ y: -4 }}
                      onClick={() => {
                        if (!trainerItem.id) return;
                        handleProfileClick("trainer", trainerItem.id);
                      }}
                      className="group cursor-pointer relative"
                    >
                      {isAdmin && (
                        <div
                          className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full bg-white/80 backdrop-blur shadow-sm hover:bg-white"
                                />
                              }
                            >
                              <MoreVertical className="w-4 h-4 text-muted-foreground" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="rounded-xl border-2"
                            >
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive font-black uppercase text-[11px] tracking-widest p-3 gap-2"
                                onClick={() => {
                                  if (!trainerItem.id) return;
                                  handleDeleteTrainer(
                                    trainerItem.id,
                                    trainerItem.fullName,
                                  );
                                }}
                                disabled={isDeletingTrainer === trainerItem.id}
                              >
                                {isDeletingTrainer === trainerItem.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                                {isDeletingTrainer === trainerItem.id
                                  ? "Deleting..."
                                  : "Delete Trainer"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                      <Card className="rounded-[24px] sm:rounded-[28px] border-2 group-hover:border-primary group-hover:shadow-2xl group-hover:shadow-primary/10 transition-all overflow-hidden h-full">
                        <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center space-y-3 sm:space-y-4 text-foreground">
                          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[20px] sm:rounded-[24px] bg-muted group-hover:bg-primary transition-colors flex items-center justify-center text-xl sm:text-2xl font-black group-hover:text-white">
                            {trainerItem.initials}
                          </div>
                          <div className="space-y-0.5 sm:space-y-1 min-w-0 w-full">
                            <p className="font-black uppercase italic tracking-tighter truncate group-hover:text-primary transition-colors text-base sm:text-lg leading-tight">
                              {trainerItem.fullName}
                            </p>
                            <Badge
                              variant="outline"
                              className="text-[7px] sm:text-[11px] font-black uppercase tracking-widest px-1.5 h-4 sm:h-5"
                            >
                              {upcCount} UPCOMING
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </section>

            {/* Clients Section */}
            <section className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="text-xl font-black uppercase italic tracking-tight">
                    Client Directory
                  </h3>
                </div>

                <div className="flex items-center gap-3 p-1 bg-muted rounded-2xl border-2 border-border/10">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "h-10 rounded-xl px-4 gap-2 font-black uppercase text-[11px] tracking-widest",
                      )}
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Sort:{" "}
                      {sortOption === "recent"
                        ? "Recent Activity"
                        : sortOption === "new"
                          ? "New Profiles"
                          : "Upcoming"}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="rounded-2xl border-2 p-1 w-56"
                    >
                      <DropdownMenuItem
                        onClick={() => setSortOption("recent")}
                        className="rounded-xl font-bold uppercase text-[11px] tracking-widest p-3"
                      >
                        Recent Activity
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSortOption("new")}
                        className="rounded-xl font-bold uppercase text-[11px] tracking-widest p-3"
                      >
                        New Profiles
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSortOption("upcoming")}
                        className="rounded-xl font-bold uppercase text-[11px] tracking-widest p-3"
                      >
                        Upcoming Sessions
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid gap-3 sm:gap-4">
                {sortedClients.map((client) => (
                  <motion.div
                    key={client.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => handleProfileClick("client", client.id!)}
                    className="group cursor-pointer"
                  >
                    <Card className="rounded-[24px] sm:rounded-[32px] border-2 group-hover:border-primary group-hover:shadow-2xl transition-all overflow-hidden p-0.5 sm:p-1">
                      <CardContent className="p-0 flex flex-col sm:flex-row items-center">
                        <div className="p-4 sm:p-6 flex items-center gap-4 sm:gap-5 grow w-full sm:w-auto">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-muted group-hover:bg-primary transition-colors flex items-center justify-center font-black text-lg sm:text-xl group-hover:text-white shrink-0">
                            {(client.firstName || '?')[0] || '?'}
                            {(client.lastName || '')[0] || ''}
                          </div>
                          <div>
                            <h4 className="text-xl sm:text-2xl font-black uppercase italic tracking-tighter leading-none group-hover:text-primary transition-colors">
                              {client.firstName} {client.lastName}
                            </h4>
                            <div className="flex items-center gap-2 sm:gap-3 mt-1.5">
                              <Badge
                                variant="outline"
                                className="text-[7px] sm:text-[11px] font-black uppercase tracking-widest bg-muted/50 border-none px-1.5 sm:px-2 h-4"
                              >
                                {client.occupation || "Private Profile"}
                              </Badge>
                              <span className="text-[11px] sm:text-[11px] font-bold text-muted-foreground uppercase">
                                SESSIONS: {client.remainingSessions}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 grow-2 w-full sm:w-auto p-4 sm:p-0">
                          <div className="flex flex-col justify-center px-4 sm:px-6 border-l py-2 sm:py-4 min-w-30 sm:min-w-35">
                            <p className="text-[11px] sm:text-[11px] font-black uppercase text-muted-foreground tracking-widest mb-1 leading-none">
                              Last Log
                            </p>
                            <p className="text-xs sm:text-sm font-black italic">
                              {client.lastSessionTime > 0
                                ? new Date(
                                    client.lastSessionTime,
                                  ).toLocaleDateString([], {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "No Record"}
                            </p>
                          </div>
                          <div className="flex flex-col justify-center px-4 sm:px-6 border-l py-2 sm:py-4 min-w-30 sm:min-w-35">
                            <p className="text-[11px] sm:text-[11px] font-black uppercase text-primary tracking-widest mb-1 leading-none">
                              Upcoming
                            </p>
                            <p className="text-xs sm:text-sm font-black italic text-primary leading-none">
                              {client.nextSessionTime !== Infinity
                                ? new Date(
                                    client.nextSessionTime,
                                  ).toLocaleDateString([], {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "---"}
                            </p>
                          </div>
                        </div>

                        <div className="hidden sm:flex p-6 border-l items-center justify-center w-full sm:w-auto">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-muted flex items-center justify-center group-hover:border-primary group-hover:bg-primary transition-all">
                            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground group-hover:text-white transition-all transform group-hover:translate-x-0.5" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}

                {sortedClients.length === 0 && (
                  <div className="py-24 text-center border-2 border-dashed rounded-[32px] bg-muted/10">
                    <Users className="w-16 h-16 text-muted-foreground/10 mx-auto mb-4" />
                    <p className="text-sm font-black uppercase text-muted-foreground tracking-widest">
                      No clients found matching your search
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Rapid Action Floating Button (optional, but consistent with ADD CLIENT request) */}
            <div className="fixed bottom-24 right-8 z-40 hidden md:block">
              <Button
                size="lg"
                className="h-16 w-16 rounded-full shadow-2xl shadow-primary/40 p-0"
                onClick={() => setView("clients")} // Go to Dashboard for adding
              >
                <Plus className="w-8 h-8" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <StrongConfirmationModal
        isOpen={!!trainerToDeleteObj}
        title="Delete Trainer Profile"
        description={`Are you absolutely sure you want to delete trainer "${trainerToDeleteObj?.name || ""}"? This action cannot be undone and will permanently erase all associated data.`}
        confirmationPhrase="DELETE TRAINER"
        onConfirm={performDeleteTrainer}
        onCancel={() => setTrainerToDeleteObj(null)}
      />

      <StrongConfirmationModal
        isOpen={showMockConfirm}
        title="Provision Mock Client Data"
        description="This will create a new mock client with 60 days of session data. Continue?"
        confirmationPhrase="GENERATE MOCK"
        onConfirm={performGenerateMock}
        onCancel={() => setShowMockConfirm(false)}
      />
    </motion.div>
  );
}
