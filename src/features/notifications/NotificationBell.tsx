/**
 * The bell in the global header.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Deliberately quiet: a dot with a count, no sound, no toast, no interruption.
 * Everything it announces is something that already happened correctly —
 * a task got done, a request got picked up — so it has no business taking a
 * trainer's attention off a client mid-set.
 */

import React, { useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
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
import type { NotificationKind, TrainerNotification } from "./types";

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

export interface NotificationBellProps {
  trainerId?: string | null;
  /** Where a notification's link should take the app. */
  onNavigate?: (view: string, id?: string) => void;
  className?: string;
}

export function NotificationBell({
  trainerId,
  onNavigate,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount } = useNotifications(trainerId);

  const tap = async (n: TrainerNotification) => {
    if (!trainerId) return;
    if (!n.readAt) {
      // Not awaited: navigation should not wait on a write, and a failed
      // mark-read leaves the badge up, which is the safe direction to fail.
      markNotificationRead(trainerId, n.id).catch(() => {});
    }
    if (n.link && onNavigate) {
      onNavigate(n.link.view, n.link.id);
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        title="Notifications"
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
        }
        className={
          className ??
          "relative h-8 w-8 sm:h-10 sm:w-10 rounded-full transition-all hover:bg-transparent shrink-0 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50"
        }
      >
        <Bell className="w-4 h-4 sm:w-6 sm:h-6 md:w-7 md:h-7" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-cta text-white text-[9px] font-black flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="bg-card p-0 flex flex-col sm:max-w-md"
        >
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
            <SheetTitle className="text-xl font-black italic tracking-tight uppercase text-foreground">
              Notifications
            </SheetTitle>
            <SheetDescription className="text-muted-foreground font-bold uppercase text-[10px] tracking-widest">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
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

          {unreadCount > 0 && trainerId && (
            <div className="px-5 py-4 border-t border-border">
              <Button
                variant="outline"
                onClick={() =>
                  markAllNotificationsRead(trainerId, notifications).catch(() => {})
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
