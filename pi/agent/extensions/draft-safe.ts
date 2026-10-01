// draft-safe — run slash commands or one-off prompts without losing your draft.
//
// alt+;  park & restore (toggle):
//   - editor has draft text  → parks it; editor clears so you can type a
//     /command or another prompt yourself
//   - editor is empty (or holds only "/")  → puts the draft back
//
// The parked draft behaves like durable state of the pi instance:
// - Survives running commands, submitting prompts, /fork, /new, /resume,
//   and /reload (the widget is re-shown on every session_start).
// - Persisted to ~/.local/state/pi/draft-safe/parked.json (atomic write) at
//   park time and removed at restore time. If pi exits or crashes while a
//   draft is parked, the next pi start adopts it automatically and shows it
//   above the editor again.
// - Every park is appended to history.jsonl (capped at 50) — a disk-backed
//   audit trail so a draft is recoverable even beyond the current session.
// - Every submitted prompt is still mirrored to last-submitted.txt.
//
// Multi-instance safe: parked.json records the owning pid; a live instance
// never adopts another instance's parked draft.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const STATE_DIR = join(homedir(), ".local", "state", "pi", "draft-safe");
const PARKED_FILE = join(STATE_DIR, "parked.json");
const HISTORY_FILE = join(STATE_DIR, "history.jsonl");
const LAST_SUBMITTED = join(STATE_DIR, "last-submitted.txt");
const HISTORY_CAP = 50;

let parked: string | null = null;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

async function writeParkedFile(text: string): Promise<void> {
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await atomicWrite(PARKED_FILE, JSON.stringify({ pid: process.pid, ts: Date.now(), text }));
  } catch {
    // Persistence is best effort; the in-memory + history trail still apply.
  }
}

async function logHistory(text: string): Promise<void> {
  try {
    await appendFile(HISTORY_FILE, JSON.stringify({ ts: Date.now(), text }) + "\n", "utf8");
    const raw = await readFile(HISTORY_FILE, "utf8").catch(() => "");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length > HISTORY_CAP) {
      await atomicWrite(HISTORY_FILE, lines.slice(-HISTORY_CAP).join("\n") + "\n");
    }
  } catch {
    // Never let the audit trail break parking.
  }
}

async function clearParkedFile(): Promise<void> {
  try {
    await rm(PARKED_FILE, { force: true });
  } catch {
    // Ignore — worst case the next startup adopts an already-restored draft.
  }
}

function previewLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 2) {
    return [lines[0], lines[1], `… (${lines.length - 2} more lines)`];
  }
  return lines;
}

function showParked(ui: { setStatus: (k: string, t: string | undefined) => void; setWidget: (k: string, c: string[] | undefined, o?: { placement?: string }) => void }): void {
  ui.setStatus("draft-safe", "📎 draft parked — alt+; restores");
  ui.setWidget(
    "draft-safe",
    ["📎 draft parked — alt+; restores:", ...previewLines(parked ?? "")],
    { placement: "aboveEditor" },
  );
}

function hideParked(ui: { setStatus: (k: string, t: string | undefined) => void; setWidget: (k: string, c: string[] | undefined, o?: { placement?: string }) => void }): void {
  ui.setStatus("draft-safe", undefined);
  ui.setWidget("draft-safe", undefined);
}

/** Adopt parked.json if its owner is gone. Returns the adopted text or null. */
async function adoptOrphanedDraft(): Promise<string | null> {
  try {
    if (!existsSync(PARKED_FILE)) return null;
    const data = JSON.parse(await readFile(PARKED_FILE, "utf8")) as { pid?: number; text?: unknown };
    if (typeof data.pid === "number" && data.pid !== process.pid && pidAlive(data.pid)) {
      return null; // A live pi instance owns this draft; leave it be.
    }
    if (typeof data.text === "string" && data.text.trim()) {
      return data.text; // Owner is gone (crash/exit) — we adopt it.
    }
  } catch {
    // Corrupt file: fall through to null; history.jsonl still has the text.
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("alt+;", {
    description: "Park draft / restore draft (run slash commands in between)",
    handler: async (ctx) => {
      const text = ctx.ui.getEditorText();
      const trimmed = text.trim();

      if (parked === null) {
        if (!trimmed) {
          ctx.ui.notify("Nothing to park — the editor is empty.", "info");
          return;
        }
        if (trimmed.startsWith("/")) return; // already typing a command, not a draft
        parked = text;
        ctx.ui.setEditorText("");
        await writeParkedFile(parked);
        await logHistory(parked);
        showParked(ctx.ui);
        return;
      }

      // A draft is parked. Restore only when restoring cannot lose anything:
      // the editor must be empty, or hold nothing but a stray "/".
      if (trimmed && trimmed !== "/") {
        ctx.ui.notify("Editor has unsubmitted text — parked draft kept. Submit or clear it first.", "warning");
        return;
      }

      ctx.ui.setEditorText(parked);
      parked = null;
      hideParked(ctx.ui);
      await clearParkedFile();
    },
  });

  // Re-assert (or recover) the parked draft on every session lifecycle event:
  // startup/reload adopt an orphaned parked.json; new/resume/fork re-show the
  // widget in case the UI was rebuilt.
  pi.on("session_start", async (_event, ctx) => {
    if (parked === null) {
      const adopted = await adoptOrphanedDraft();
      if (adopted === null) return;
      parked = adopted;
      await writeParkedFile(parked); // Re-own under this pid.
      if (ctx.ui?.setWidget) {
        ctx.ui.notify("Recovered a parked draft from the previous run — alt+; restores it.", "info");
      }
    }
    if (parked !== null && ctx.ui?.setWidget) {
      showParked(ctx.ui);
    }
  });

  // Belt and braces: mirror every submitted prompt to disk (best effort).
  pi.on("input", async (event) => {
    const text = event.text?.trim();
    if (!text) return;
    try {
      await mkdir(STATE_DIR, { recursive: true });
      await writeFile(LAST_SUBMITTED, text);
    } catch {
      // Never let the safety net break the input.
    }
  });
}
