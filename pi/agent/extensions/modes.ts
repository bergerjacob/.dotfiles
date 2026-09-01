// /mode — switch the primary agent and all subagents between model presets.
//
// Usage:
//   /mode              interactive picker (shows current mode and mapping)
//   /mode <name>       switch primary + subagents for this pi instance only
//   /mode <name> keep  switch and persist; every new pi instance starts this way
//   /mode off          clear the overlay AND persisted mode (back to config defaults)
//
// How it works:
// - Primary: pi.setModel() + pi.setThinkingLevel() — instant, this session.
// - Subagents: every `subagent` tool call gets the mode's model/thinking injected
//   as a per-run override, which outranks agent frontmatter. Explicit model in a
//   tool call always wins. No config files are modified, so git stays clean.
// - Persistence lives in ~/.pi/agent/modes-state.json (machine-local, unmanaged).
// - Known gap: children spawned inside workflowScript runs.run() calls bypass the
//   tool-call hook. While a mode is active a short system-prompt note tells the
//   parent to pass explicit per-child models, which covers that path in practice.
//
// Edit MODES below to tune models or add presets (e.g. a free/opencode mode later).

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";

interface Pick {
  model: string;
  thinking?: string;
}

interface Mode {
  description: string;
  primary: Pick;
  agents: Record<string, Pick>;
}

const STATE_FILE = join(homedir(), ".pi", "agent", "modes-state.json");

const MODES: Record<string, Mode> = {
  openai: {
    description: "All OpenAI via Codex subscription",
    primary: { model: "openai-codex/gpt-5.6-sol", thinking: "high" },
    agents: {
      fast: { model: "openai-codex/gpt-5.6-luna", thinking: "low" },
      standard: { model: "openai-codex/gpt-5.6-terra", thinking: "medium" },
      oracle: { model: "openai-codex/gpt-5.6-sol", thinking: "high" },
    },
  },
  glm: {
    description: "All Z.ai GLM (5.3 / 5.3-flash)",
    primary: { model: "zai/glm-5.3-flash", thinking: "high" },
    agents: {
      fast: { model: "zai/glm-5.3-flash", thinking: "low" },
      standard: { model: "zai/glm-5.3", thinking: "high" },
      oracle: { model: "zai/glm-5.3", thinking: "max" },
    },
  },
};

// Agent name aliases (mirror agent frontmatter) so injections also match
// launches made through an alias such as `agent: "medium"`.
const AGENT_ALIASES: Record<string, string> = {
  fast: "fast",
  cheap: "fast",
  low: "fast",
  small: "fast",
  standard: "standard",
  medium: "standard",
  oracle: "oracle",
  expert: "oracle",
  expensive: "oracle",
  high: "oracle",
  big: "oracle",
  main: "main",
};

let activeMode: string | null = null;

function pickFor(mode: Mode, agentName: string | undefined): Pick | undefined {
  const raw = (agentName ?? "main").toLowerCase();
  const canonical = AGENT_ALIASES[raw] ?? raw;
  if (canonical === "main") return mode.primary;
  return mode.agents[canonical];
}

function formatPick(pick: Pick): string {
  return pick.thinking ? `${pick.model}:${pick.thinking}` : pick.model;
}

function modeSummary(name: string): string {
  const mode = MODES[name];
  const agents = Object.entries(mode.agents)
    .map(([agent, pick]) => `${agent}→${formatPick(pick)}`)
    .join("  ");
  return `mode: ${name} · primary ${formatPick(mode.primary)} · ${agents}`;
}

async function updateStatus(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  if (activeMode) {
    ctx.ui.setStatus("mode", modeSummary(activeMode));
  } else {
    ctx.ui.setStatus("mode", undefined);
  }
}

async function applyMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
  notifyResult: boolean,
): Promise<boolean> {
  const mode = MODES[name];
  if (!mode) return false;

  const slash = mode.primary.model.indexOf("/");
  const model = ctx.modelRegistry.find(
    mode.primary.model.slice(0, slash),
    mode.primary.model.slice(slash + 1),
  );
  if (!model) {
    if (notifyResult && ctx.hasUI) {
      ctx.ui.notify(`/mode: model ${mode.primary.model} not in registry`, "error");
    }
    return false;
  }

  const ok = await pi.setModel(model);
  if (!ok) {
    if (notifyResult && ctx.hasUI) {
      ctx.ui.notify(`/mode: no credentials for ${mode.primary.model}`, "error");
    }
    return false;
  }
  if (mode.primary.thinking) {
    pi.setThinkingLevel(mode.primary.thinking as never);
  }

  activeMode = name;
  await updateStatus(ctx);
  if (notifyResult && ctx.hasUI) {
    ctx.ui.notify(modeSummary(name), "info");
  }
  return true;
}

async function clearMode(ctx: ExtensionContext, notifyResult: boolean): Promise<void> {
  activeMode = null;
  await updateStatus(ctx);
  if (notifyResult && ctx.hasUI) {
    ctx.ui.notify("mode: off — using config defaults", "info");
  }
}

function resolveModeName(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (MODES[lower]) return lower;
  const matches = Object.keys(MODES).filter((k) => k.startsWith(lower));
  return matches.length === 1 ? matches[0] : undefined;
}

export default function (pi: ExtensionAPI) {
  // Restore a persisted mode at startup so `keep` survives new pi instances.
  // Subagent children skip this: they already get model/thinking via the
  // parent's per-run override, and re-applying the primary pick here would
  // clobber e.g. a `fast` child's low thinking with the primary's level.
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.PI_SUBAGENT_CHILD === "1") return;
    try {
      const state = JSON.parse(await readFile(STATE_FILE, "utf8")) as { mode?: string };
      if (state && typeof state.mode === "string" && MODES[state.mode]) {
        await applyMode(pi, ctx, state.mode, false);
      }
    } catch {
      // No state file (or unreadable) — config defaults apply.
    }
  });

  // Inject per-run overrides into every subagent launch (top precedence in
  // pi-subagents, so this outranks agent frontmatter without editing files).
  pi.on("tool_call", async (event) => {
    const mode = activeMode ? MODES[activeMode] : undefined;
    if (!mode || event.toolName !== "subagent") return;

    const input = event.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object") return;
    // Orchestration scripts, resumes, and management actions are left alone.
    if (input.action || input.workflowScript || input.resume) return;

    const inject = (item: unknown): boolean => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      if (record.model) return false; // explicit per-run choice wins
      const pick = pickFor(mode, typeof record.agent === "string" ? record.agent : undefined);
      if (!pick) return false;
      record.model = pick.model;
      if (pick.thinking && !record.thinking) record.thinking = pick.thinking;
      return true;
    };

    inject(input);
    if (Array.isArray(input.tasks)) {
      for (const task of input.tasks) inject(task);
    }
  });

  // Nudge the parent to carry explicit models into workflowScript children,
  // which the tool-call hook cannot reach.
  pi.on("before_agent_start", async (event) => {
    const mode = activeMode ? MODES[activeMode] : undefined;
    if (!mode || process.env.PI_SUBAGENT_CHILD === "1") return;
    const agents = Object.entries(mode.agents)
      .map(([agent, pick]) => `${agent}=${formatPick(pick)}`)
      .join(", ");
    return {
      systemPrompt: `${event.systemPrompt}\n\nActive model mode: ${activeMode} (primary ${formatPick(
        mode.primary,
      )}). When spawning subagents inside workflowScript runs.run() calls, pass these explicit per-child model overrides: ${agents}.`,
    };
  });

  pi.registerCommand("mode", {
    description:
      "Model preset for primary + subagents: /mode <openai|glm> [keep], /mode off, or /mode for a picker",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
        ...Object.entries(MODES).map(([name, mode]) => ({
          value: name,
          label: `${name} — ${mode.description}`,
        })),
        { value: "off", label: "off — back to config defaults (clears kept mode)" },
        { value: "keep", label: "keep — suffix to persist across pi instances" },
      ];
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const parts = (args ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.toLowerCase());
      const keep = parts.includes("keep");
      const namePart = parts.find((part) => part !== "keep");

      // No argument: show picker in TUI, otherwise just report status.
      if (!namePart) {
        if (ctx.hasUI && ctx.mode === "tui") {
          const current = activeMode ? `${activeMode} (active)` : "off (config defaults)";
          const choice = await ctx.ui.select(
            `Switch mode — current: ${current}`,
            Object.keys(MODES).concat("off"),
          );
          if (choice === undefined) return;
          if (choice === "off") {
            await rm(STATE_FILE, { force: true });
            await clearMode(ctx, true);
          } else if (await applyMode(pi, ctx, choice, true)) {
            await rm(STATE_FILE, { force: true }); // picker switches are session-local
          }
          return;
        }
        ctx.ui.notify(activeMode ? modeSummary(activeMode) : "mode: off (config defaults)", "info");
        return;
      }

      if (namePart === "off") {
        await rm(STATE_FILE, { force: true });
        await clearMode(ctx, true);
        return;
      }

      const name = resolveModeName(namePart);
      if (!name) {
        ctx.ui.notify(
          `/mode: unknown mode "${namePart}" — available: ${Object.keys(MODES).join(", ")}, off`,
          "error",
        );
        return;
      }

      if (await applyMode(pi, ctx, name, true)) {
        if (keep) {
          await writeFile(STATE_FILE, `${JSON.stringify({ mode: name }, null, 2)}\n`, "utf8");
          if (ctx.hasUI) ctx.ui.notify(`mode ${name} kept for future pi instances`, "info");
        } else {
          await rm(STATE_FILE, { force: true }); // switching without keep clears persistence
        }
      }
    },
  });
}
