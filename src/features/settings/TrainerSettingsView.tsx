/**
 * TRAINER SETTINGS — what is left after the RBAC teardown.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * WHY THIS IS NOT JUST THE BUG FORM
 * ---------------------------------
 * Strip A/B2/B4/C/D/E/F/G out of the old Hub Settings and exactly one card
 * survives: Report a Bug. A settings screen containing a single form does not
 * read as "streamlined", it reads as failed to load — and a trainer who thinks
 * a screen is broken files a bug about the bug reporter.
 *
 * So the screen stops being about SETTINGS, which a trainer now has none of by
 * design, and becomes about the two things they do have: a voice (what is
 * broken) and an identity (who am I, where do I work). The account block is
 * deliberately READ-ONLY — home studio, cross-training access and the Mindbody
 * link are Admin writes now — but showing them still answers the questions
 * trainers actually raise ("am I linked to Mindbody?", "why can't I see Solon's
 * clients?") without a support message, and read-only rows make the page feel
 * substantial without granting an inch of permission back.
 */

import React from "react";
import {
  Bug,
  ChevronRight,
  ClipboardList,
  Dumbbell,
  Lightbulb,
  LogOut,
  Palette,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Trainer, Studio, Machine } from "../../types";
import { isStudioLeader } from "../../lib/permissions";
import { useFeedback, useMyFeedback, FEEDBACK_KIND_SHORT } from "../feedback";
import type { FeedbackKind } from "../feedback";

export interface TrainerSettingsViewProps {
  authTrainer: Trainer | null;
  studios: Studio[];
  trainers: Trainer[];
  machines: Machine[];
  activeStudioId: string | null;
  onLogout?: () => void;
  setView?: (view: string) => void;
}

const KIND_BUTTONS: { kind: FeedbackKind; icon: typeof Bug }[] = [
  { kind: "bug", icon: Bug },
  { kind: "ui", icon: Palette },
  { kind: "idea", icon: Lightbulb },
];

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  investigating: "Looking at it",
  fixed: "Fixed",
  "wont-fix": "Closed",
};

function Card({
  icon: Icon,
  title,
  subtitle,
  children,
  accent,
}: {
  icon: typeof Bug;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={[
        "rounded-[28px] border bg-card overflow-hidden",
        accent
          ? "border-cta/40 shadow-lg shadow-cta/5"
          : "border-border shadow-sm dark:shadow-none",
      ].join(" ")}
    >
      <header className="flex items-center gap-3.5 px-5 sm:px-7 pt-5 sm:pt-6 pb-4">
        <div
          className={[
            "w-11 h-11 rounded-2xl flex items-center justify-center border shrink-0",
            accent
              ? "bg-cta/10 border-cta/30"
              : "bg-muted border-border shadow-inner",
          ].join(" ")}
        >
          <Icon className={accent ? "w-5 h-5 text-cta" : "w-5 h-5 text-muted-foreground"} />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg sm:text-xl font-black italic tracking-tight uppercase text-foreground truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="text-muted-foreground font-bold uppercase text-[9px] sm:text-[10px] tracking-widest leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </header>
      <div className="px-5 sm:px-7 pb-5 sm:pb-6">{children}</div>
    </section>
  );
}

/** A read-only fact. Not an input — that is the point. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-border/50 last:border-0">
      <dt className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">
        {label}
      </dt>
      <dd className="text-sm font-bold text-foreground text-right min-w-0">{value}</dd>
    </div>
  );
}

function LinkRow({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Bug;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-border bg-background hover:bg-muted transition-colors text-left disabled:opacity-50 min-h-[52px]"
    >
      <Icon className="w-4 h-4 text-cta shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] font-black uppercase tracking-widest text-foreground">
          {label}
        </span>
        {hint && (
          <span className="block text-[10px] font-medium text-muted-foreground truncate">
            {hint}
          </span>
        )}
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

export function TrainerSettingsView({
  authTrainer,
  studios,
  trainers,
  machines,
  activeStudioId,
  onLogout,
  setView,
}: TrainerSettingsViewProps) {
  const { open } = useFeedback();
  const { reports, counts } = useMyFeedback(authTrainer?.id);

  const studioName = (id?: string | null) =>
    studios.find((s) => s.id === id)?.name || "—";

  const activeStudio = studios.find((s) => s.id === activeStudioId);

  // Cross-training locations, minus the home studio it already shows above.
  const otherStudios = (authTrainer?.accessibleStudioIds || [])
    .filter((id) => id && id !== authTrainer?.primaryHomeStudioId)
    .map(studioName);

  const studioTrainerCount = trainers.filter(
    (t) =>
      t.primaryHomeStudioId === activeStudioId ||
      t.accessibleStudioIds?.includes(activeStudioId || ""),
  ).length;

  const leader = isStudioLeader(authTrainer);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto w-full px-2.5 sm:px-6 py-4 sm:py-8 space-y-5"
    >
      <div className="px-1 mb-1">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight uppercase italic text-foreground">
          Trainer Settings
        </h2>
        <p className="text-muted-foreground uppercase text-[9px] sm:text-[11px] font-black tracking-widest">
          Your account and your feedback.
        </p>
      </div>

      {/* ── HERO: feedback ───────────────────────────────────────────── */}
      <Card
        icon={Bug}
        title="Help us build this"
        subtitle="You are in beta — nothing is too small"
        accent
      >
        <p className="text-sm text-muted-foreground font-medium leading-relaxed mb-4">
          Tell us what is broken, what feels wrong, and what is missing. We
          attach the screen you were on automatically, so you only have to
          describe it in your own words.
        </p>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {KIND_BUTTONS.map(({ kind, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => open(kind)}
              className="flex flex-col items-center justify-center gap-1.5 h-[72px] sm:h-20 rounded-2xl border border-border bg-background hover:bg-cta/10 hover:border-cta/40 transition-all font-black uppercase text-[9px] sm:text-[10px] tracking-widest text-muted-foreground hover:text-foreground"
            >
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-cta" />
              {FEEDBACK_KIND_SHORT[kind]}
            </button>
          ))}
        </div>

        {/* A trainer who never sees what happened to a report stops filing
            them. This is the loop, and it is why the hero is not just a form. */}
        {counts.total > 0 && (
          <div className="pt-4 border-t border-border">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2.5">
              Your reports · {counts.open} open · {counts.resolved} closed
            </p>
            <ul className="space-y-1.5">
              {reports.slice(0, 3).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 text-xs bg-background rounded-xl border border-border/60 px-3 py-2.5"
                >
                  <span className="flex-1 min-w-0 truncate text-foreground font-medium">
                    {r.description}
                  </span>
                  <span
                    className={[
                      "text-[9px] font-black uppercase tracking-widest shrink-0",
                      r.status === "fixed"
                        ? "text-green"
                        : r.status === "wont-fix"
                          ? "text-muted-foreground"
                          : "text-cta",
                    ].join(" ")}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── My account (read-only by design) ─────────────────────────── */}
      <Card icon={UserCircle} title="My account" subtitle="Managed by your studio admin">
        <dl>
          <Fact label="Name" value={authTrainer?.fullName || "—"} />
          <Fact label="Role" value={authTrainer?.role || "Trainer"} />
          <Fact
            label="Home studio"
            value={studioName(authTrainer?.primaryHomeStudioId)}
          />
          {otherStudios.length > 0 && (
            <Fact label="Also works at" value={otherStudios.join(" · ")} />
          )}
          <Fact
            label="Mindbody"
            value={
              authTrainer?.mindbodyStaffId ? (
                <span className="text-green">
                  Linked · {authTrainer.mindbodyStaffId}
                </span>
              ) : (
                <span className="text-amber">Not linked</span>
              )
            }
          />
        </dl>

        {onLogout && (
          <Button
            variant="outline"
            onClick={onLogout}
            className="mt-4 w-full h-11 rounded-2xl border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        )}
      </Card>

      {/* ── My studio: two links, not a module ───────────────────────── */}
      <Card
        icon={Dumbbell}
        title={activeStudio?.name ? `My studio — ${activeStudio.name}` : "My studio"}
        subtitle={`${machines.length} machines · ${studioTrainerCount} on the roster`}
      >
        <div className="space-y-2">
          <LinkRow
            icon={Dumbbell}
            label="Machine catalog"
            hint="Setup, settings, cleaning and maintenance"
            onClick={setView ? () => setView("machine-anatomy") : undefined}
          />
          <LinkRow
            icon={ClipboardList}
            label="Studio to-do"
            hint="Today's tasks and requests"
            onClick={setView ? () => setView("studio-tasks") : undefined}
          />
        </div>
      </Card>

      {/* ── Leaders only: the door to the tier above ─────────────────── */}
      {leader && (
        <Card
          icon={ShieldCheck}
          title="Studio & admin tools"
          subtitle="Staff, reports, integrations and equipment"
        >
          <p className="text-sm text-muted-foreground font-medium leading-relaxed mb-3">
            Team management, data exports, Mindbody integration and the global
            machine editor now live in the admin dashboard.
          </p>
          <LinkRow
            icon={ShieldCheck}
            label="Open admin dashboard"
            onClick={setView ? () => setView("admin-dashboard") : undefined}
          />
        </Card>
      )}
    </motion.div>
  );
}
