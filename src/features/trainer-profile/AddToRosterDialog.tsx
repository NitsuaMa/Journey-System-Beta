import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  KAIZEN_REASONS,
  KAIZEN_REASON_HINTS,
  type Client,
  type KaizenReason,
} from "../../types";
import { NOTE_MAX } from "./roster";

/**
 * Add a client to the roster: find them, say why, optionally set a date to
 * check back.
 *
 * The reason is REQUIRED and defaults to nothing being pre-selected, because
 * a reason nobody chose is a reason nobody meant. It is the field that turns
 * a list of names into a plan, and it costs one tap.
 */
export function AddToRosterDialog({
  open,
  onOpenChange,
  clients,
  alreadyOnRoster,
  onAdd,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  alreadyOnRoster: Set<string>;
  onAdd: (
    client: Client,
    reason: KaizenReason,
    options: { note?: string; reviewBy?: Date | null },
  ) => Promise<boolean>;
  saving: boolean;
}) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const [reason, setReason] = useState<KaizenReason | null>(null);
  const [note, setNote] = useState("");
  const [reviewBy, setReviewBy] = useState("");

  const reset = () => {
    setTerm("");
    setSelected(null);
    setReason(null);
    setNote("");
    setReviewBy("");
  };

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    return clients
      .filter((c) => c.id && !alreadyOnRoster.has(c.id))
      .filter((c) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [term, clients, alreadyOnRoster]);

  const submit = async () => {
    if (!selected || !reason) return;
    const ok = await onAdd(selected, reason, {
      note,
      reviewBy: reviewBy ? new Date(`${reviewBy}T12:00:00`) : null,
    });
    if (ok) {
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Kaizen Roster</DialogTitle>
        </DialogHeader>

        <div className="tp" style={{ padding: 0, gap: 14, paddingBottom: 0, background: "transparent" }}>
          {!selected ? (
            <>
              <div>
                <span className="tp-label">Client</span>
                <div style={{ position: "relative" }}>
                  <Search
                    size={15}
                    aria-hidden
                    style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}
                  />
                  <Input
                    autoFocus
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder="Search by name"
                    style={{ paddingLeft: 32 }}
                  />
                </div>
              </div>

              {term.trim() && (
                <div className="tp-card">
                  {matches.length === 0 ? (
                    <div className="tp-card__body">
                      <p className="tp-empty">
                        No matches. Clients already on your roster are hidden.
                      </p>
                    </div>
                  ) : (
                    <div className="tp-rows">
                      {matches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="tp-row"
                          onClick={() => setSelected(c)}
                        >
                          <span className="tp-row__main">
                            <span className="tp-row__name">
                              {c.firstName} {c.lastName}
                            </span>
                            {c.sessionCount != null && (
                              <span className="tp-row__sub">Session #{c.sessionCount}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="tp-home">
                <div>
                  <span className="tp-label" style={{ marginBottom: 2 }}>
                    Client
                  </span>
                  <span className="tp-home__name">
                    {selected.firstName} {selected.lastName}
                  </span>
                </div>
                <button
                  type="button"
                  className="tp-btn tp-btn--ghost"
                  style={{ marginLeft: "auto", minHeight: 34 }}
                  onClick={() => setSelected(null)}
                >
                  Change
                </button>
              </div>

              <div>
                <span className="tp-label">Why are you tracking them?</span>
                <div className="tp-tags">
                  {KAIZEN_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={r === reason ? "tp-chip tp-chip--kaizen" : "tp-chip"}
                      style={{ height: 34, cursor: "pointer" }}
                      onClick={() => setReason(r)}
                      title={KAIZEN_REASON_HINTS[r]}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {reason && (
                  <p className="tp-empty" style={{ marginTop: 6 }}>
                    {KAIZEN_REASON_HINTS[reason]}
                  </p>
                )}
              </div>

              <div>
                <span className="tp-label">Note (optional)</span>
                <Input
                  value={note}
                  maxLength={NOTE_MAX}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What are you watching for?"
                />
              </div>

              <div>
                <span className="tp-label">Check back on (optional)</span>
                <Input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={!selected || !reason || saving}
            style={!selected || !reason || saving ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            onClick={submit}
          >
            {saving ? "Adding…" : "Add to roster"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
