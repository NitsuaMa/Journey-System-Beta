/**
 * The beta feedback drawer.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Opens from the bottom because the app is used two-handed on a 10-13" iPad
 * held in portrait: a bottom sheet puts the kind buttons and the send button
 * inside thumb reach, where a centred dialog puts them under the far hand.
 */

import React, { useEffect, useState } from "react";
import { Bug, Check, Lightbulb, Palette, Send } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "../../contexts/ToastContext";
import { describeContext } from "./capture";
import { submitFeedback } from "./mutations";
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KIND_PLACEHOLDER,
  FEEDBACK_KIND_SHORT,
  type FeedbackContext,
  type FeedbackKind,
} from "./types";
import type { FeedbackAuthor } from "./FeedbackProvider";

const KINDS: { kind: FeedbackKind; icon: typeof Bug }[] = [
  { kind: "bug", icon: Bug },
  { kind: "ui", icon: Palette },
  { kind: "idea", icon: Lightbulb },
];

export interface FeedbackDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind: FeedbackKind;
  context: FeedbackContext;
  author: FeedbackAuthor;
}

export function FeedbackDrawer({
  open,
  onOpenChange,
  initialKind,
  context,
  author,
}: FeedbackDrawerProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // Follow the kind the caller asked for, but only on open: changing it
  // mid-typing because a parent re-rendered would be baffling.
  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setSent(false);
    }
  }, [open, initialKind]);

  const summary = describeContext(context);

  const send = async () => {
    if (!description.trim() || busy) return;
    setBusy(true);
    try {
      await submitFeedback({ kind, description, context, author });
      setSent(true);
      setDescription("");
      toastSuccess("Thank you — that went straight to the team.");
      // Held open briefly so the confirmation is actually seen; a drawer that
      // vanishes on tap leaves the trainer unsure whether it sent.
      window.setTimeout(() => onOpenChange(false), 1200);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toastError(`Could not send that: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-t border-border bg-card p-0 max-h-[92dvh] overflow-y-auto"
      >
        <SheetHeader className="px-5 pt-5 pb-3 sm:px-7">
          <SheetTitle className="text-xl sm:text-2xl font-black italic tracking-tight uppercase text-foreground">
            Help us build this
          </SheetTitle>
          <SheetDescription className="text-muted-foreground font-bold uppercase text-[10px] sm:text-[11px] tracking-widest">
            You are in beta. Nothing is too small to mention.
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 pb-6 sm:px-7 space-y-4">
          {/* Kind — three targets, min h-14, chosen for gloved/sweaty taps. */}
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map(({ kind: k, icon: Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 h-16 sm:h-20 rounded-2xl border transition-all font-black uppercase text-[9px] sm:text-[10px] tracking-widest",
                  kind === k
                    ? "bg-cta/10 border-cta text-foreground shadow-sm"
                    : "bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5 sm:w-6 sm:h-6",
                    kind === k ? "text-cta" : "opacity-50",
                  )}
                />
                {FEEDBACK_KIND_SHORT[k]}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm sm:text-base font-bold text-foreground">
              {FEEDBACK_KIND_LABEL[kind]}
            </p>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={FEEDBACK_KIND_PLACEHOLDER[kind]}
              rows={5}
              autoFocus
              className="rounded-2xl bg-background border-border text-foreground text-base resize-none min-h-[120px]"
            />
          </div>

          {/* Shown, not hidden: a trainer should know what leaves their iPad. */}
          {summary && (
            <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium leading-relaxed">
              <span className="font-black uppercase tracking-widest">
                Attached automatically:
              </span>{" "}
              {summary}
            </p>
          )}

          <Button
            onClick={send}
            disabled={!description.trim() || busy || sent}
            className="w-full h-12 sm:h-14 rounded-2xl bg-cta text-white font-black uppercase text-[11px] sm:text-xs tracking-widest gap-2 disabled:opacity-40"
          >
            {sent ? (
              <>
                <Check className="w-4 h-4" /> Sent
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> {busy ? "Sending…" : "Send to the team"}
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
