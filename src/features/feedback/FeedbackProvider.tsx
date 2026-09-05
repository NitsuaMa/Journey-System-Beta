/**
 * Makes the feedback drawer reachable from anywhere.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * WHY A PROVIDER RATHER THAN A COMPONENT PER ENTRY POINT
 * -----------------------------------------------------
 * There are three ways in — the header icon, the Trainer Settings hero card,
 * and "Report this" on a failure — and there will be more. Mounting a drawer
 * at each one would mean three copies of the open state, three captures, and
 * three chances for two to be open at once.
 *
 * So the drawer is mounted once, near the root, and everything else calls
 * `useFeedback().open()`. The caller passes nothing: the provider already
 * holds the studio, view and client, which is the whole point of capturing
 * context at open rather than asking each call site to assemble it.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { captureFeedbackContext } from "./capture";
import { FeedbackDrawer } from "./FeedbackDrawer";
import type { FeedbackContext, FeedbackKind } from "./types";

export interface FeedbackAuthor {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  studioId?: string | null;
}

interface FeedbackApi {
  /** Opens the drawer, capturing context now. */
  open: (kind?: FeedbackKind) => void;
  isOpen: boolean;
}

const Ctx = createContext<FeedbackApi | null>(null);

export interface FeedbackProviderProps {
  children: React.ReactNode;
  author: FeedbackAuthor;
  /** Live "where am I" values. Read at open time, not at render time. */
  view?: string;
  studioId?: string | null;
  studioName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  sessionId?: string | null;
  theme?: string | null;
}

export function FeedbackProvider({
  children,
  author,
  view,
  studioId,
  studioName,
  clientId,
  clientName,
  sessionId,
  theme,
}: FeedbackProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [context, setContext] = useState<FeedbackContext>({});

  const open = useCallback(
    (next: FeedbackKind = "bug") => {
      // Snapshot the screen the trainer is complaining about, before the
      // drawer covers it and before they spend a minute typing.
      setContext(
        captureFeedbackContext({
          view,
          studioId,
          studioName,
          clientId,
          clientName,
          sessionId,
          theme,
        }),
      );
      setKind(next);
      setIsOpen(true);
    },
    [view, studioId, studioName, clientId, clientName, sessionId, theme],
  );

  const api = useMemo<FeedbackApi>(() => ({ open, isOpen }), [open, isOpen]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <FeedbackDrawer
        open={isOpen}
        onOpenChange={setIsOpen}
        initialKind={kind}
        context={context}
        author={author}
      />
    </Ctx.Provider>
  );
}

/**
 * Returns a no-op opener outside the provider rather than throwing.
 *
 * A missing provider must never be the reason a screen white-screens: this is
 * the reporting path, so its own failure mode has to be quiet. The button
 * simply does nothing, which is visible in testing and harmless in production.
 */
export function useFeedback(): FeedbackApi {
  const ctx = useContext(Ctx);
  return ctx ?? { open: () => {}, isOpen: false };
}
