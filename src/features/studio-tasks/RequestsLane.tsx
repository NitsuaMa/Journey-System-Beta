/**
 * The floating lane: ad-hoc asks and low-priority studio comms.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * SITS ABOVE THE CHECKLIST, NOT MIXED INTO IT
 * -------------------------------------------
 * A shift-cover ask is time-sensitive in a way that "take out the trash" is
 * not. Interleaving the two by timestamp would bury "can anyone take my 5pm?"
 * under three opening duties, which is exactly how it gets missed and how
 * people go back to texting each other instead.
 *
 * COLLAPSED BY DEFAULT ONCE EVERYTHING IS ANSWERED
 * ------------------------------------------------
 * The lane earns its place at the top only while something needs a person. An
 * empty lane renders as a single line with the composer, so the checklist -
 * which is what most trainers open this screen for - is still the first thing
 * under the thumb.
 */

import { useState } from "react";
import {
  Check,
  ChevronDown,
  HandHelping,
  HelpCircle,
  Megaphone,
  MessageSquare,
  Repeat,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import {
  addRequestReply,
  createRequest,
  REQUEST_KIND_HINT,
  REQUEST_KIND_LABEL,
  resolveRequest,
  setRequestClaim,
  type RequestKind,
  type TaskRequest,
} from "./requests";
import { useRequestReplies, useStudioRequests } from "./useStudioRequests";
import { notify } from "../notifications";
import type { TaskAuthor } from "./mutations";

const KIND_ICON: Record<RequestKind, typeof MessageSquare> = {
  cover: Repeat,
  question: HelpCircle,
  "heads-up": Megaphone,
  help: HandHelping,
  other: MessageSquare,
};

const KINDS: RequestKind[] = ["cover", "question", "heads-up", "help", "other"];

function ago(v: unknown): string {
  const ms = (v as { toMillis?: () => number } | undefined)?.toMillis?.();
  if (!ms) return "just now";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export interface RequestsLaneProps {
  studioId: string | null;
  author: TaskAuthor | null;
  /** Auth uid, for "is this mine". */
  currentUserId?: string | null;
}

export function RequestsLane({ studioId, author }: RequestsLaneProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const { open: openRequests } = useStudioRequests(studioId);

  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<RequestKind>("cover");
  const [title, setTitle] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!studioId || !author) {
      toastError("No active studio.");
      return;
    }
    setBusy(true);
    try {
      await fn();
      toastSuccess(ok);
    } catch (err) {
      console.error("Request write failed:", err);
      toastError("Could not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!title.trim() || !studioId || !author) return;
    await run(
      () => createRequest({ studioId, author, kind, title }),
      "Posted to the board.",
    );
    setTitle("");
    setComposing(false);
  };

  const claim = async (r: TaskRequest) => {
    const mine = r.claimedBy?.id === author?.id;
    await run(async () => {
      await setRequestClaim({
        studioId: studioId!,
        requestId: r.id,
        author,
        claimed: !mine,
      });
      if (!mine) {
        // Best-effort by design — notify() swallows its own failures, so a
        // claim never fails because the bell did.
        await notify({
          to: r.createdBy.id,
          actor: author,
          kind: "request-claimed",
          title: `${author?.name} picked up "${r.title}"`,
          studioId: studioId!,
          link: { view: "studio-tasks" },
        });
      }
    }, mine ? "Handed back." : "You've got it.");
  };

  const resolve = async (r: TaskRequest) => {
    await run(async () => {
      await resolveRequest({ studioId: studioId!, requestId: r.id, author });
      await notify({
        to: r.createdBy.id,
        actor: author,
        kind: "request-resolved",
        title: `${author?.name} closed "${r.title}"`,
        studioId: studioId!,
        link: { view: "studio-tasks" },
      });
    }, "Closed.");
  };

  return (
    <section className="stq" aria-label="Studio requests">
      <header className="stq__head">
        <MessageSquare size={14} aria-hidden />
        <h2 className="stq__title">Requests</h2>
        {openRequests.length > 0 && (
          <span className="stq__count">{openRequests.length}</span>
        )}
        <button
          type="button"
          className="stq__new"
          onClick={() => setComposing((v) => !v)}
          aria-expanded={composing}
        >
          {composing ? <X size={13} aria-hidden /> : <Send size={13} aria-hidden />}
          {composing ? "Cancel" : "Ask the studio"}
        </button>
      </header>

      {composing && (
        <div className="stq__composer">
          <div className="stq__kinds" role="group" aria-label="Kind of request">
            {KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  className="stq__kind"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  title={REQUEST_KIND_HINT[k]}
                >
                  <Icon size={13} aria-hidden />
                  {REQUEST_KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
          <div className="stq__row">
            <input
              className="stq__input"
              value={title}
              placeholder={REQUEST_KIND_HINT[kind]}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void post();
                }
              }}
              aria-label="What do you need?"
            />
            <button
              type="button"
              className="stq__post"
              onClick={() => void post()}
              disabled={!title.trim() || busy}
            >
              <Send size={13} aria-hidden />
              Post
            </button>
          </div>
        </div>
      )}

      {openRequests.length === 0 ? (
        !composing && (
          <p className="stq__empty">
            Nothing floating. Post here to ask for cover, flag something, or
            get another trainer's read on a client.
          </p>
        )
      ) : (
        <ul className="stq__list">
          {openRequests.map((r) => {
            const Icon = KIND_ICON[r.kind] ?? MessageSquare;
            const mine = r.claimedBy?.id === author?.id;
            const isAuthor = r.createdBy.id === author?.id;
            return (
              <li
                key={r.id}
                className="stq__item"
                data-urgent={r.priority === "urgent" || undefined}
              >
                <div className="stq__item-main">
                  <span className="stq__icon" aria-hidden>
                    <Icon size={14} />
                  </span>
                  <span className="stq__item-text">
                    <span className="stq__item-title">{r.title}</span>
                    <span className="stq__item-sub">
                      {r.createdBy.name} · {ago(r.createdAt)}
                      {r.replyCount > 0
                        ? ` · ${r.replyCount} repl${r.replyCount === 1 ? "y" : "ies"}`
                        : ""}
                      {r.claimedBy ? ` · ${r.claimedBy.name} has this` : ""}
                    </span>
                  </span>

                  <button
                    type="button"
                    className="stq__act"
                    onClick={() => void claim(r)}
                    disabled={busy}
                    aria-pressed={Boolean(mine)}
                  >
                    <Sparkles size={12} aria-hidden />
                    {mine ? "Drop" : r.claimedBy ? "Take over" : "Claim"}
                  </button>

                  {isAuthor && (
                    <button
                      type="button"
                      className="stq__act"
                      onClick={() => void resolve(r)}
                      disabled={busy}
                    >
                      <Check size={12} aria-hidden />
                      Close
                    </button>
                  )}

                  <button
                    type="button"
                    className="stq__act"
                    onClick={() => setThreadId(threadId === r.id ? null : r.id)}
                    aria-expanded={threadId === r.id}
                  >
                    <ChevronDown size={12} aria-hidden />
                    Reply
                  </button>
                </div>

                {threadId === r.id && (
                  <RequestThread
                    studioId={studioId}
                    request={r}
                    author={author}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One request's replies.
 *
 * Mounted only while the thread is open, which is the point: a board showing
 * twelve requests holds zero reply listeners until somebody taps one.
 */
function RequestThread({
  studioId,
  request,
  author,
}: {
  studioId: string | null;
  request: TaskRequest;
  author: TaskAuthor | null;
}) {
  const { replies } = useRequestReplies(studioId, request.id);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!body.trim() || !studioId || !author) return;
    setBusy(true);
    try {
      await addRequestReply({
        studioId,
        requestId: request.id,
        author,
        body,
      });
      await notify({
        to: request.createdBy.id,
        actor: author,
        kind: "request-replied",
        title: `${author.name} replied to "${request.title}"`,
        body,
        studioId,
        link: { view: "studio-tasks" },
      });
      setBody("");
    } catch (err) {
      console.error("Reply failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stq__thread">
      {request.detail && <p className="stq__detail">{request.detail}</p>}
      {replies.length > 0 && (
        <ul className="stq__replies">
          {replies.map((rep) => (
            <li key={rep.id} className="stq__reply">
              <span className="stq__reply-who">{rep.author.name}</span>
              <span className="stq__reply-body">{rep.body}</span>
              <span className="stq__reply-when">{ago(rep.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="stq__row">
        <input
          className="stq__input"
          value={body}
          placeholder="Reply…"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          aria-label={`Reply to ${request.title}`}
        />
        <button
          type="button"
          className="stq__post"
          onClick={() => void send()}
          disabled={!body.trim() || busy}
        >
          <Send size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
