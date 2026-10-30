// auto-resume — send "Continue" for you when a run dies on a provider limit or outage.
//
// Pi's built-in retry gives up after ~10 minutes and never retries quota errors,
// so a usage window that reopens in a few hours leaves the session parked until
// someone types "Continue". When a run settles on an error, this classifies the
// message, waits, and sends "Continue" itself:
//
// - quota/usage limit with a reset time  → sleep until the reset (+ margin)
//     "Try again in ~269 min"                      (Codex)
//     "Your limit will reset at 2026-09-05 13:15"  (z.ai, UTC+8)
//     "Claude quota exceeded — … resets 3:45 PM"   (pi-claude-bridge, local)
// - quota/usage limit without a reset    → poll every POLL_MS
// - transient outage after pi's retries  → exponential backoff
// - auth, bad request, context overflow, aborts, unknown errors → left alone
//
// Typing anything (or starting any run) cancels a pending resume.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MARGIN_MS = 30_000;
const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 24 * 60 * 60_000;
const POLL_MS = 20 * 60_000;
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
const MAX_CONSECUTIVE = 48;
const Z_AI_UTC_OFFSET_HOURS = 8;

const NO_RESUME =
  /authenticat|auth token|unauthori[sz]ed|forbidden|not supported|invalid|context.?(?:length|window)|too long|overflow|(?:^|\(|status:?\s*)(?:400|401|403|404)\b/i;
const QUOTA =
  /usage limit|limit (?:reached|exhausted|exceeded)|hit your .{0,30}limit|quota|insufficient[_ ]balance|no resource package|out of (?:extra )?usage|credits?\b|billing/i;
const TRANSIENT =
  /overloaded|rate.?limit|too many requests|\b(?:429|500|502|503|504|520|524)\b|unavailable|server.?(?:error|busy)|internal.?error|provider returned error|network|connection|fetch failed|ENOTFOUND|EAI_AGAIN|socket|timed? ?out|timeout|terminated|websocket|ended without|stream ended|upstream|ResourceExhausted|other side closed|no body|retry/i;

export type Classification =
  | { kind: "skip" }
  | { kind: "quota"; delayMs?: number }
  | { kind: "transient" };

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** Milliseconds until the limit resets, or undefined when the message has no usable hint. */
export function parseResetDelayMs(message: string, now = Date.now()): number | undefined {
  const rel = message.match(
    /(?:try again|retry)[^0-9]{0,15}(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i,
  );
  if (rel) return Number(rel[1]) * UNIT_MS[rel[2][0].toLowerCase()];

  const abs = message.match(/reset at (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/i);
  if (abs) {
    const [, y, mo, d, h, mi, s] = abs.map(Number);
    return Date.UTC(y, mo - 1, d, h - Z_AI_UTC_OFFSET_HOURS, mi, s) - now;
  }

  const tod = message.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap]m)?/i);
  if (tod && (tod[4] || tod[2])) {
    let hour = Number(tod[1]);
    const meridiem = tod[4]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    const target = new Date(now);
    target.setHours(hour, Number(tod[2] ?? 0), Number(tod[3] ?? 0), 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now;
  }
  return undefined;
}

export function classify(errorMessage: string, now = Date.now()): Classification {
  if (NO_RESUME.test(errorMessage)) return { kind: "skip" };
  if (QUOTA.test(errorMessage)) return { kind: "quota", delayMs: parseResetDelayMs(errorMessage, now) };
  if (TRANSIENT.test(errorMessage)) return { kind: "transient" };
  return { kind: "skip" };
}

function formatDelay(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

export default function autoResume(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAssistant: any;
  let consecutive = 0;
  let clearStatus: (() => void) | undefined;

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    clearStatus?.();
    clearStatus = undefined;
  }

  pi.on("agent_start", () => {
    cancel();
    lastAssistant = undefined;
  });

  pi.on("message_end", (event) => {
    if ((event.message as any).role === "assistant") lastAssistant = event.message;
  });

  pi.on("input", (event) => {
    if (event.source !== "extension") cancel();
    return undefined;
  });

  pi.on("session_shutdown", () => cancel());

  pi.on("agent_settled", (event, ctx) => {
    const message = lastAssistant;
    lastAssistant = undefined;
    if (event.aborted || message?.stopReason !== "error" || !message.errorMessage) {
      if (!event.aborted && message) consecutive = 0;
      return;
    }
    if (consecutive >= MAX_CONSECUTIVE) {
      if (ctx.hasUI) ctx.ui.notify(`auto-resume: gave up after ${consecutive} attempts`, "warning");
      return;
    }

    const verdict = classify(String(message.errorMessage));
    if (verdict.kind === "skip") return;

    let delayMs: number;
    if (verdict.kind === "quota") {
      delayMs = verdict.delayMs === undefined ? POLL_MS : verdict.delayMs + MARGIN_MS;
    } else {
      delayMs = Math.min(BACKOFF_BASE_MS * 2 ** consecutive, BACKOFF_CAP_MS);
    }
    delayMs = Math.max(delayMs, MIN_DELAY_MS);

    if (delayMs > MAX_DELAY_MS) {
      if (ctx.hasUI) {
        ctx.ui.notify(`auto-resume: limit resets in ${formatDelay(delayMs)}, not waiting`, "warning");
      }
      return;
    }

    cancel();
    consecutive++;
    const at = new Date(Date.now() + delayMs);
    const label = `auto-resume ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${verdict.kind}, ${formatDelay(delayMs)}) — type anything to cancel`;
    if (ctx.hasUI) {
      ctx.ui.setStatus("auto-resume", label);
      clearStatus = () => ctx.ui.setStatus("auto-resume", undefined);
    }
    timer = setTimeout(() => {
      timer = undefined;
      clearStatus?.();
      clearStatus = undefined;
      if (!ctx.isIdle()) return;
      pi.sendUserMessage("Continue").catch(() => {});
    }, delayMs);
  });
}
