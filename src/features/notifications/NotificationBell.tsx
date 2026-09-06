/**
 * The bell in the global header. THE bell, singular, as of Sep 6 2026.
 *
 * Round: Settings tiers & Task Board, Sep 2026. Announcements folded in Sep 6.
 *
 * Deliberately quiet: a dot with a count, no sound, no toast, no interruption.
 * Everything it announces is something that already happened correctly -
 * a task got done, a request got picked up - so it has no business taking a
 * trainer's attention off a client mid-set.
 *
 * TWO FEEDS, ONE SHEET, IN A FIXED ORDER
 * --------------------------------------
 * The header used to carry a second bell for `hub_announcements`. Two bells is
 * not a choice a trainer can make from the glyph, so the announcements stream
 * moved into `useHubAnnouncements` and renders here as a PINNED section above
 * the activity feed.
 *
 * The order is not negotiable and is not by timestamp. An announcement is
 * something a manager decided everyone should read; a notification is a
 * receipt for something that already went right. Interleaving the two by time
 * buries "the studio closes at 3 on Thursday" under nine completed cleaning
 * tasks - which is the exact failure the Requests lane was separated from the
 * checklist to avoid. So announcements sit on top, and they stop being pinned
 * once read.
 */

import React, { useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Megaphone,
  MessageSquare,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNotifications } from "./useNotifications";
import { markAllNotificationsRead, markNotificationRead } from "./mutations";
import {
  markAnnouncementsRead,
  useHubAnnouncements,
} from "./useHubAnnouncements";
import type { NotificationKind, TrainerNotification } from "./types";
import type { HubAnnouncement, Trainer } from "../../types";

const ICON: Record<NotificationKind, typeof Bell> = {
  "task-completed": Check,
  "request-claimed": Sparkles,
  "request-replied": MessageSquare,
  "request-resolved": CheckCheck,
  "machine-flagged": TriangleAlert,
};

function ago(v: unknown): string {
  const ms = (v as { toMillis?: () => number } | undefined)?.toMillis?.();
  if (!ms) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function announcementDate(v: unknown): string {
  const d = (v as { toDate?: () => Date } | undefined)?.toDate?.();
  if (!d) return "Recently";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function scopeLabel(a: HubAnnouncement): string {
  if (a.targetScope === "universal" || a.studioId === "all") return "Universal";
  if (a.targetScope === "network") return "Network";
  return "Studio";
}

export interface NotificationBellProps {
  trainerId?: string | null;
  /** Needed for announcement scope targeting; also supplies trainerId. */
  authTrainer?: Trainer | null;
  /** Where a notification's link should take the app. */
  onNavigate?: (view: string, id?: string) => void;
  className?: string;
}

export function NotificationBell({
  trainerId,
  authTrainer,
  onNavigate,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const uid = trainerId ?? authTrainer?.id ?? null;
  const { notifications, unreadCount } = useNotifications(uid);
  const {
    announcements,
    unread: unreadAnnouncements,
    unreadCount: announcementCount,
  } = useHubAnnouncements(authTrainer);

  // One badge for both feeds. A trainer looking at the header is asking "is
  // there anything for me", not "which subsystem produced it".
  const badge = unreadCount + announcementCount;

  const openSheet = (next: boolean) => {
    setOpen(next);
    // Marked on OPEN, not on render - see useHubAnnouncements.
    if (next && unreadAnnouncements.length > 0) {
      markAnnouncementsRead(authTrainer?.id, unreadAnnouncements);
    }
  };

  const tap = async (n: TrainerNotification) => {
    if (!uid) return;
    if (!n.readAt) {
      // Not awaited: navigation should not wait on a write, and a failed
      // mark-read leaves the badge up, which is the safe direction to fail.
      markNotificationRead(uid, n.id).catch(() => {});
    }
    if (n.link && onNavigate) {
      onNavigate(n.link.view, n.link.id);
      setOpen(false);
    }
  };

  const nothingAtAll =
    notifications.length === 0 && announcements.length === 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => openSheet(true)}
        title="Notifications"
        aria-label={
          badge > 0 ? `Notifications, ${badge} unread` : "Notifications"
        }
        className={
          className ??
          "relative h-9 w-9 sm:h-10 sm:w-10 rounded-full transition-all hover:bg-transparent shrink-0 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"
        }
      >
        <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
        {badge > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-cta text-white text-[9px] font-black flex items-center justify-center leading-none">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={openSheet}>
        <SheetContent
          side="right"
          className="bg-card p-0 flex flex-col sm:max-w-md"
        >
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <SheetTitle className="text-xl font-black italic tracking-tight uppercase text-foreground">
              Notifications
            </SheetTitle>
            <SheetDescription className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">
              {badge > 0 ? `${badge} unread` : "All caught up"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {announcements.length > 0 && (
              <section aria-label="Studio announcements">
                <h3 className="px-5 pt-4 pb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Megaphone className="w-3.5 h-3.5" />
                  From the studio
                </h3>
                <ul className="px-5 pb-4 space-y-2">
                  {announcements.map((a) => {
                    const isNew = unreadAnnouncements.some((u) => u.id === a.id);
                    return (
                      <li
                        key={a.id}
                        className={[
                          "rounded-2xl border p-3.5",
                          isNew
                            ? "border-cta/40 bg-cta/5"
                            : "border-border bg-muted/40",
                        ].join(" ")}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-black italic uppercase tracking-tight text-foreground">
                            {a.title}
                          </span>
                          {a.priority === "high" && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber/15 text-amber">
                              Urgent
                            </span>
                          )}
                          {isNew && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-cta/15 text-cta">
                              New
                            </span>
                          )}
                        </div>
                        {a.shortContent && (
                          <p className="mt-1 text-xs font-semibold text-foreground/80 leading-snug">
                            {a.shortContent}
                          </p>
                        )}
                        {a.longContent && (
                          <p className="mt-2 pt-2 border-t border-dashed border-border text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            {a.longContent}
                          </p>
                        )}
                        <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          {a.authorName} · {announcementDate(a.createdAt)} ·{" "}
                          {scopeLabel(a)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {notifications.length > 0 && (
                  <h3 className="px-5 pt-1 pb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground border-t border-border">
                    <span className="block pt-3">Activity</span>
                  </h3>
                )}
              </section>
            )}

            {nothingAtAll ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground font-medium">
                Nothing yet. You'll hear when someone finishes a task you
                created, or picks up a request you posted.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((n) => {
                  const Icon = ICON[n.kind] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => tap(n)}
                        className={[
                          "w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted",
                          n.readAt ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "w-8 h-8 rounded-xl flex items-center justify-center border shrink-0",
                            n.kind === "machine-flagged"
                              ? "bg-amber/10 border-amber/30 text-amber"
                              : "bg-muted border-border text-cta",
                          ].join(" ")}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-foreground leading-snug">
                            {n.title}
                          </span>
                          {n.body && (
                            <span className="block text-xs text-muted-foreground font-medium mt-0.5 line-clamp-2">
                              {n.body}
                            </span>
                          )}
                          <span className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-1">
                            {ago(n.createdAt)}
                          </span>
                        </span>
                        {!n.readAt && (
                          <span className="w-2 h-2 rounded-full bg-cta shrink-0 mt-2" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {unreadCount > 0 && uid && (
            <div className="px-5 py-4 border-t border-border">
              <Button
                variant="outline"
                onClick={() =>
                  markAllNotificationsRead(uid, notifications).catch(() => {})
                }
                className="w-full h-11 rounded-2xl border-border font-black uppercase text-[10px] tracking-widest gap-2"
              >
                <CheckCheck className="w-4 h-4" />
                Mark all read
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
