import React, { useState, useMemo } from "react";
import {
  Search,
  User2,
  PlayCircle,
  Plus,
  MapPin,
  MoreVertical,
  Minus,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useActiveStudio } from "../ActiveStudioContext";
import { Client, Trainer } from "../types";
import { db } from "../firebase";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import SyncStatusBadge from "./mindbody/SyncStatusBadge";

interface Props {
  clients: Client[];
  onSelectClient: (clientId: string) => void;
  onStartOpenSession?: () => void;
  authTrainer?: Trainer | null;
  /**
   * Client ids on the signed-in trainer's Kaizen Roster.
   *
   * Passed in rather than read here: `authTrainer` is captured at sign-in and
   * never re-read, so a roster edit made this session would not show up. The
   * caller derives this from the live `trainers` snapshot.
   */
  kaizenClientIds?: Set<string>;
  onUpdateSessions?: (
    clientId: string,
    current: number,
    delta: number,
  ) => Promise<void>;
  onStartNewClientOnboarding?: (name: string) => void;
}

const DIRECTORY_COLUMNS = [
  "Client",
  "Membership",
  "Sessions Remaining",
  "Last Session",
  "Next Session",
] as const;

/** Shared so the skeleton and the real table cannot drift out of alignment. */
function DirectoryTableHead() {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/40">
        {DIRECTORY_COLUMNS.map((label) => (
          <th
            key={label}
            className="py-4 px-6 text-[10px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap"
          >
            {label}
          </th>
        ))}
        <th className="py-4 px-6 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
          Actions
        </th>
      </tr>
    </thead>
  );
}

/**
 * Placeholder rows shown while the directory query is in flight.
 *
 * Mirrors the real row layout — avatar circle, two-line name block, one bar per
 * remaining column — so the table does not jump when the data lands. Without it
 * the empty "no clients found" message appeared during every load, which reads
 * as "this studio has no clients".
 */
function DirectorySkeleton({ rows = 8 }: { rows?: number }) {
  const bar = "h-3 rounded bg-muted animate-pulse";
  return (
    <div className="w-full overflow-x-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading clients…</span>
      <table className="w-full text-left border-collapse">
        <DirectoryTableHead />
        <tbody className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td className="py-4 px-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted border border-border shrink-0 animate-pulse" />
                  <div className="flex flex-col gap-1.5">
                    <div className={cn(bar, "w-32")} />
                    <div className={cn(bar, "w-20 opacity-60")} />
                  </div>
                </div>
              </td>
              <td className="py-4 px-6">
                <div className={cn(bar, "w-20")} />
              </td>
              <td className="py-4 px-6">
                <div className={cn(bar, "w-8")} />
              </td>
              <td className="py-4 px-6">
                <div className={cn(bar, "w-24")} />
              </td>
              <td className="py-4 px-6">
                <div className={cn(bar, "w-24")} />
              </td>
              <td className="py-4 px-6">
                <div className={cn(bar, "w-6 ml-auto")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClientDirectoryView({
  clients,
  onSelectClient,
  onStartOpenSession,
  authTrainer,
  kaizenClientIds,
  onUpdateSessions,
  onStartNewClientOnboarding,
}: Props) {
  const { availableStudios, activeStudioId } = useActiveStudio();
  const [searchTerm, setSearchTerm] = useState("");
  const [isGlobalSearch, setIsGlobalSearch] = useState(false);
  const [rosterOnly, setRosterOnly] = useState(false);
  const [dbSearchResults, setDbSearchResults] = useState<Client[]>([]);
  const [isSearchingDb, setIsSearchingDb] = useState(false);

  const handleUpdateSessions = async (
    clientId: string,
    current: number,
    delta: number,
  ) => {
    if (onUpdateSessions) {
      setDbSearchResults((prev) =>
        prev.map((c) =>
          c.id === clientId
            ? { ...c, remainingSessions: Math.max(0, current + delta) }
            : c,
        ),
      );
      try {
        await onUpdateSessions(clientId, current, delta);
      } catch (err) {
        console.error("Failed to update sessions:", err);
        setDbSearchResults((prev) =>
          prev.map((c) =>
            c.id === clientId ? { ...c, remainingSessions: current } : c,
          ),
        );
      }
    }
  };

  React.useEffect(() => {
    if (!searchTerm.trim()) {
      setIsSearchingDb(true);
      const fetchRecentClients = async () => {
        try {
          const clientsRef = collection(db, "clients");
          let q;
          if (!isGlobalSearch && activeStudioId) {
            q = query(
              clientsRef,
              where("homeStudioId", "==", activeStudioId),
              limit(30),
            );
          } else {
            q = query(clientsRef, limit(30));
          }
          const snap = await getDocs(q);
          const fetched = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as any) }) as Client,
          );
          setDbSearchResults(fetched);
        } catch (err) {
          console.error("Error fetching recent clients:", err);
        } finally {
          setIsSearchingDb(false);
        }
      };
      fetchRecentClients();
      return;
    }
    setIsSearchingDb(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const term = searchTerm.trim().toLowerCase();
        const alphaOnly = term.replace(/[^a-z]/g, "");
        const prefixLen = alphaOnly.length > 3 ? 3 : alphaOnly.length;
        const prefix = alphaOnly.slice(0, prefixLen);
        const prefixCapitalized =
          prefix.charAt(0).toUpperCase() + prefix.slice(1);

        if (!prefixCapitalized) {
          setDbSearchResults([]);
          setIsSearchingDb(false);
          return;
        }

        const clientsRef = collection(db, "clients");
        const q1 = query(
          clientsRef,
          where("firstName", ">=", prefixCapitalized),
          where("firstName", "<=", prefixCapitalized + "\uf8ff"),
          limit(30),
        );
        const q2 = query(
          clientsRef,
          where("lastName", ">=", prefixCapitalized),
          where("lastName", "<=", prefixCapitalized + "\uf8ff"),
          limit(30),
        );

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const uniqueDocs = new Map<string, any>();
        [...snap1.docs, ...snap2.docs].forEach((d) => {
          uniqueDocs.set(d.id, { id: d.id, ...d.data() });
        });

        const candidates = Array.from(uniqueDocs.values());
        const fetched = candidates.filter((c) => {
          const first = (c.firstName || "").toLowerCase();
          const last = (c.lastName || "").toLowerCase();
          const full = `${first} ${last}`;
          const mb = (c.mindbody_name || "").toLowerCase();

          return (
            first.includes(term) ||
            last.includes(term) ||
            full.includes(term) ||
            mb.includes(term) ||
            term.includes(first) ||
            term.includes(last)
          );
        });

        setDbSearchResults(fetched);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearchingDb(false);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, isGlobalSearch, activeStudioId]);

  const [clientLastSessionMap, setClientLastSessionMap] = useState<
    Record<string, string>
  >({});

  const displayClients = useMemo(() => {
    // 1. Studio filtering
    const allowedStudioIds = [
      authTrainer?.primaryHomeStudioId,
      ...(authTrainer?.accessibleStudioIds || []),
    ].filter(Boolean) as string[];

    if (activeStudioId && !allowedStudioIds.includes(activeStudioId)) {
      allowedStudioIds.push(activeStudioId);
    }

    let filtered = Array.from(
      new Map([...clients, ...dbSearchResults].map((c) => [c.id, c])).values(),
    );

    // Filter out dummy/mock clients that do not have a valid first or last name (like test-client-999)
    filtered = filtered.filter((c) => c.firstName || c.lastName);

    // Apply Cross-Studio or Home Studio Territory Filtering if isGlobalSearch is turned off
    if (!isGlobalSearch && allowedStudioIds.length > 0) {
      filtered = filtered.filter(
        (c) => !c.homeStudioId || allowedStudioIds.includes(c.homeStudioId),
      );
    }

    // 1b. Kaizen Roster. Applied before search so "roster only" plus a name
    // search narrows within the roster rather than escaping it.
    if (rosterOnly && kaizenClientIds) {
      filtered = filtered.filter((c) => c.id && kaizenClientIds.has(c.id));
    }

    // 2. Search filtering
    if (searchTerm.trim()) {
      const terms = searchTerm.trim().toLowerCase().split(/\s+/);
      filtered = filtered.filter((c) => {
        const full =
          `${c.firstName || ""} ${c.lastName || ""} ${c.mindbody_name || ""}`.toLowerCase();
        return terms.every((term) => full.includes(term));
      });
    }

    // Sort by recent by default
    return filtered.sort((a, b) => {
      const aTime = a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : a.createdAt
          ? new Date(a.createdAt).getTime()
          : 0;
      const bTime = b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : b.createdAt
          ? new Date(b.createdAt).getTime()
          : 0;
      return bTime - aTime;
    });
  }, [
    clients,
    searchTerm,
    isGlobalSearch,
    rosterOnly,
    kaizenClientIds,
    activeStudioId,
    authTrainer,
    dbSearchResults,
  ]);

  React.useEffect(() => {
    const clientsMissingDate = displayClients.filter(
      (c) => c.id && !c.lastSessionDate && !clientLastSessionMap[c.id],
    );
    if (clientsMissingDate.length === 0) return;

    const idsToFetch = clientsMissingDate.slice(0, 30).map((c) => c.id!);

    const fetchLastSessions = async () => {
      try {
        const q = query(
          collection(db, "sessions"),
          where("clientId", "in", idsToFetch),
          limit(100),
        );
        const snap = await getDocs(q);
        const map: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const s = d.data();
          if (s.clientId && s.date) {
            if (!map[s.clientId] || s.date > map[s.clientId]) {
              map[s.clientId] = s.date;
            }
          }
        });
        if (Object.keys(map).length > 0) {
          setClientLastSessionMap((prev) => ({ ...prev, ...map }));
        }
      } catch (err) {
        console.error("Could not fetch last sessions for clients:", err);
      }
    };
    fetchLastSessions();
  }, [displayClients, clientLastSessionMap]);

  const renderTierBadge = (tier?: string) => {
    if (!tier || tier === "None")
      return <span className="text-sm text-muted-foreground">None</span>;
    if (tier.toLowerCase().includes("18"))
      return (
        <Badge className="bg-secondary text-secondary-foreground border-border uppercase tracking-wide text-xs font-semibold px-2.5 py-0.5">
          Silver
        </Badge>
      );
    if (tier.toLowerCase().includes("12"))
      return (
        <Badge className="bg-primary/10 text-primary border-primary/20 uppercase tracking-wide text-xs font-semibold px-2.5 py-0.5">
          Orange
        </Badge>
      );
    if (tier.toLowerCase().includes("6"))
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 uppercase tracking-wide text-xs font-semibold px-2.5 py-0.5">
          Blue
        </Badge>
      );
    return (
      <Badge className="bg-secondary text-secondary-foreground border-border uppercase tracking-wide text-[10px] font-bold px-2 py-0.5">
        {tier}
      </Badge>
    );
  };

  return (
    <div className="h-full bg-background p-6 lg:p-10 flex flex-col pt-12 transition-colors duration-200 overflow-hidden">
      <div className="max-w-7xl mx-auto w-full mb-6 shrink-0 flex items-center justify-between">
        <h1 className="text-3xl font-black text-foreground uppercase tracking-tight flex items-center gap-3">
          <User2 className="w-8 h-8 text-primary" />
          Client Directory
          <div className="ml-4 mb-1">
            <SyncStatusBadge />
          </div>
        </h1>
      </div>

      <div className="max-w-7xl mx-auto w-full mb-8 shrink-0">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative group flex-1">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              {isSearchingDb ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              )}
            </div>
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search clients..."
              className="w-full bg-card border border-border text-card-foreground placeholder:text-muted-foreground h-12 pl-12 rounded-xl text-base font-medium focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary shadow-sm transition-all"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {onStartNewClientOnboarding && (
              <Button
                onClick={() => onStartNewClientOnboarding("")}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-widest rounded-xl h-12 px-6 transition-all shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Client
              </Button>
            )}
          </div>
        </div>

        {activeStudioId && (
          <div className="flex items-center gap-3 mt-4 px-2">
            <button
              onClick={() => setIsGlobalSearch(!isGlobalSearch)}
              className={`w-10 h-5 rounded-full transition-colors relative ${isGlobalSearch ? "bg-primary" : "bg-muted border border-border"}`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${isGlobalSearch ? "left-5.5" : "left-0.75"}`}
              />
            </button>
            <span className="text-xs font-bold text-muted-foreground tracking-widest uppercase">
              Search Entire Corporate Network
            </span>
          </div>
        )}

        {kaizenClientIds && kaizenClientIds.size > 0 && (
          <div className="flex items-center gap-3 mt-3 px-2">
            <button
              onClick={() => setRosterOnly(!rosterOnly)}
              aria-pressed={rosterOnly}
              className={`w-10 h-5 rounded-full transition-colors relative ${rosterOnly ? "bg-[#0a548b] dark:bg-[#4a9fd8]" : "bg-muted border border-border"}`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${rosterOnly ? "left-5.5" : "left-0.75"}`}
              />
            </button>
            <span className="text-xs font-bold text-muted-foreground tracking-widest uppercase">
              My Kaizen Roster ({kaizenClientIds.size})
            </span>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto w-full flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24 bg-card rounded-2xl border border-border shadow-sm">
        {isSearchingDb && displayClients.length === 0 ? (
          // Only when there is nothing to show yet — during a re-search the
          // existing rows stay put rather than flashing to skeletons.
          <DirectorySkeleton />
        ) : displayClients.length > 0 ? (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <DirectoryTableHead />
              <tbody className="divide-y divide-border">
                {displayClients.map((client) => {
                  const isCrossTrainer =
                    activeStudioId &&
                    client.homeStudioId &&
                    client.homeStudioId !== activeStudioId;
                  const originalStudioName =
                    availableStudios?.find((s) => s.id === client.homeStudioId)
                      ?.name || "HQ Network";
                  const nextSessionDate = (client as any).nextSessionDate;

                  return (
                    <tr
                      key={client.id}
                      className="group hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => onSelectClient(client.id!)}
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 shadow-sm group-hover:border-primary transition-colors">
                            <span className="text-foreground font-black text-sm tracking-widest uppercase">
                              {client.firstName?.[0]}
                              {client.lastName?.[0]}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                              {client.firstName} {client.lastName}
                              {/* Kaizen Roster mark. Slate, never crimson --
                                  the red kaizen mark means "this rep needs
                                  work" in the session grid, and a client row
                                  must never blur the two. */}
                              {client.id && kaizenClientIds?.has(client.id) && (
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2.2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="text-[#5b6770] dark:text-[#8b98a4] shrink-0"
                                  role="img"
                                  aria-label="On your Kaizen Roster"
                                >
                                  <polyline points="2,10 6,6 10,10" opacity={0.55} />
                                  <polyline points="6,13 10,9 14,13" />
                                </svg>
                              )}
                            </span>
                            {isCrossTrainer ? (
                              <span className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3" />
                                Visiting: {originalStudioName}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3" />
                                {originalStudioName}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        {renderTierBadge(client.packageTier)}
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {client.remainingSessions ?? 0}
                          </span>
                          {onUpdateSessions && (
                            <div
                              className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                                onClick={() =>
                                  handleUpdateSessions(
                                    client.id!,
                                    client.remainingSessions ?? 0,
                                    -1,
                                  )
                                }
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                                onClick={() =>
                                  handleUpdateSessions(
                                    client.id!,
                                    client.remainingSessions ?? 0,
                                    1,
                                  )
                                }
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        <span className="text-sm text-muted-foreground">
                          {(() => {
                            const c = client as any;
                            if (c.lastSessionDate) return c.lastSessionDate;
                            if (c.id && clientLastSessionMap[c.id])
                              return clientLastSessionMap[c.id];
                            if (c.lastWorkoutDate) return c.lastWorkoutDate;
                            if (c.currentMachineMetrics) {
                              const dates = Object.values(c.currentMachineMetrics)
                                .map((m: any) => {
                                  if (!m?.lastPerformedDate) return null;
                                  if (typeof m.lastPerformedDate === "string") return m.lastPerformedDate;
                                  if (m.lastPerformedDate?.toDate) return m.lastPerformedDate.toDate().toISOString().split("T")[0];
                                  if (m.lastPerformedDate instanceof Date) return m.lastPerformedDate.toISOString().split("T")[0];
                                  return null;
                                })
                                .filter(Boolean) as string[];
                              if (dates.length > 0) {
                                dates.sort();
                                return dates[dates.length - 1];
                              }
                            }
                            return "N/A";
                          })()}
                        </span>
                      </td>
                      <td className="py-4 px-6 align-middle">
                        {nextSessionDate ? (
                          <span className="text-sm text-foreground font-medium">
                            {nextSessionDate}
                          </span>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-amber-600 dark:text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5"
                          >
                            Unscheduled
                          </Badge>
                        )}
                      </td>
                      <td
                        className="py-4 px-6 align-middle text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-48 bg-card border-border"
                          >
                            {onStartOpenSession && (
                              <DropdownMenuItem
                                className="cursor-pointer font-medium text-foreground focus:bg-muted"
                                onClick={() => onStartOpenSession()}
                              >
                                <PlayCircle className="w-4 h-4 mr-2 text-muted-foreground" />
                                Start Session
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="cursor-pointer font-medium text-foreground focus:bg-muted"
                              onClick={() => onSelectClient(client.id!)}
                            >
                              <User2 className="w-4 h-4 mr-2 text-muted-foreground" />
                              View Profile
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Search className="w-8 h-8 text-muted-foreground mb-3 opacity-50" />
            <p className="text-muted-foreground font-medium tracking-tight">
              No clients found matching your search.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
