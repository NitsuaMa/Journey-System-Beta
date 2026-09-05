/**
 * The always-there way in.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Lives in the global header next to the announcements bell, so the report is
 * one tap from wherever the problem is. That matters more than it sounds: a
 * trainer who hits a bug mid-session will not navigate to a settings screen
 * afterwards and reconstruct it from memory, and a report written an hour
 * later is missing the only details that would have made it reproducible.
 */

import React from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeedback } from "./FeedbackProvider";

export function FeedbackButton({ className }: { className?: string }) {
  const { open } = useFeedback();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => open("bug")}
      title="Report a bug or share feedback"
      aria-label="Report a bug or share feedback"
      className={
        className ??
        "h-8 w-8 sm:h-10 sm:w-10 rounded-full transition-all hover:bg-transparent shrink-0 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-50 active:text-orange-500"
      }
    >
      <Bug className="w-4 h-4 sm:w-6 sm:h-6 md:w-7 md:h-7 transition-colors hover:stroke-orange-500" />
    </Button>
  );
}
