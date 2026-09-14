// /mode — switch the primary agent and all subagents between model presets.
//
// Usage:
//   /mode              interactive picker (shows current mode and mapping)
//   /mode <name>       switch primary + subagents for this pi instance only
//   /mode <name> keep  switch and persist; every new pi instance starts this way
//   /mode off          clear the overlay AND persisted mode (back to config defaults)
//
// Custom mode (manually picked mapping):
//   /mode custom [keep]         opens the table editor (below). Selecting
//                               custom from the /mode picker does the same.
//                               The editor opens pre-filled with the last
//                               saved values with the cursor on "save &
//                               continue", so re-applying an unchanged
//                               mapping is just enter, enter.
//   ("edit" is still accepted: /mode custom edit == /mode custom)
//
//     → save & continue
//       main      <model>              <thinking>
//       fast      <model>              <thinking>
//       standard  <model>              <thinking>
//       oracle    <model>              <thinking>
//
//     ↑/↓ moves between rows, ←/→ between the model/thinking cells, enter
//     edits the focused cell (model cells use pi's built-in model picker),
//     esc closes without saving. "save & continue" writes the mapping and
//     applies it.
//
//     Saved to ~/.pi/agent/modes-custom.json (machine-local, unmanaged) and
//     re-read fresh on every use, so it can also be edited by hand:
//       { "primary": { "model": "provider/id", "thinking": "high" },
//         "agents": { "fast": {...}, "standard": {...}, "oracle": {...} } }
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
// Edit MODES below to tune models or add presets.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getPackageDir } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, rm, writeFile } from "node:fs/promises";

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
const CUSTOM_FILE = join(homedir(), ".pi", "agent", "modes-custom.json");

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

const CUSTOM_MODE_NAME = "custom";

const AGENT_SLOTS: Array<{ key: string; label: string }> = [
  { key: "main", label: "main (primary)" },
  { key: "fast", label: "fast" },
  { key: "standard", label: "standard" },
  { key: "oracle", label: "oracle" },
];

const THINKING_CHOICES = ["default", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

// ---------------------------------------------------------------------------
// Mode lookup (static presets + custom mode read fresh from disk)
// ---------------------------------------------------------------------------

function isValidPick(pick: unknown): pick is Pick {
  return (
    typeof pick === "object" &&
    pick !== null &&
    typeof (pick as Pick).model === "string" &&
    (pick as Pick).model.includes("/")
  );
}

async function getMode(name: string): Promise<Mode | undefined> {
  if (name !== CUSTOM_MODE_NAME) return MODES[name];
  try {
    const parsed = JSON.parse(await readFile(CUSTOM_FILE, "utf8")) as Mode;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !isValidPick(parsed.primary) ||
      typeof parsed.agents !== "object" ||
      parsed.agents === null ||
      !Object.values(parsed.agents).every(isValidPick)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined; // no custom mode saved (or unreadable/invalid)
  }
}

function pickFor(mode: Mode, agentName: string | undefined): Pick | undefined {
  const raw = (agentName ?? "main").toLowerCase();
  const canonical = AGENT_ALIASES[raw] ?? raw;
  if (canonical === "main") return mode.primary;
  return mode.agents[canonical];
}

function formatPick(pick: Pick): string {
  return pick.thinking ? `${pick.model}:${pick.thinking}` : pick.model;
}

function modeSummary(name: string, mode: Mode): string {
  const agents = Object.entries(mode.agents)
    .map(([agent, pick]) => `${agent}→${formatPick(pick)}`)
    .join("  ");
  return `mode: ${name} · primary ${formatPick(mode.primary)} · ${agents}`;
}

async function updateStatus(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  const mode = activeMode ? await getMode(activeMode) : undefined;
  ctx.ui.setStatus("mode", mode ? modeSummary(activeMode!, mode) : undefined);
}

async function applyMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
  notifyResult: boolean,
): Promise<boolean> {
  const mode = await getMode(name);
  if (!mode) {
    if (notifyResult && ctx.hasUI) {
      const hint =
        name === CUSTOM_MODE_NAME ? " — none saved yet, run /mode custom" : "";
      ctx.ui.notify(`/mode: unknown mode "${name}"${hint}`, "error");
    }
    return false;
  }

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
    ctx.ui.notify(modeSummary(name, mode), "info");
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
  const names = Object.keys(MODES).concat(CUSTOM_MODE_NAME);
  if (names.includes(lower)) return lower;
  const matches = names.filter((k) => k.startsWith(lower));
  return matches.length === 1 ? matches[0] : undefined;
}

// ---------------------------------------------------------------------------
// pi's built-in model selector, deep-imported from the running install
// ---------------------------------------------------------------------------

type CoreSelectorComponent = Container & {
  focused: boolean;
  handleInput(data: string): void;
  dispose?(): void;
};

type CoreModelSelector = new (
  tui: { requestRender(): void },
  currentModel: Model<any> | undefined,
  settings: unknown,
  modelRuntime: unknown,
  scopedModels: ReadonlyArray<{ model: Model<any>; thinkingLevel?: string }>,
  onSelect: (model: Model<any>) => void,
  onCancel: () => void,
  initialSearchInput?: string,
) => CoreSelectorComponent;

let coreSelectorCtor: CoreModelSelector | undefined;

async function loadCoreModelSelector(): Promise<CoreModelSelector> {
  if (!coreSelectorCtor) {
    // Deep-import pi's own ModelSelectorComponent. Absolute path bypasses the
    // package "exports" map; the module's theme is a globalThis singleton, so
    // it follows the active theme.
    const url = pathToFileURL(
      join(getPackageDir(), "dist", "modes", "interactive", "components", "model-selector.js"),
    ).href;
    coreSelectorCtor = (await import(url)).ModelSelectorComponent as CoreModelSelector;
  }
  return coreSelectorCtor;
}

// ---------------------------------------------------------------------------
// Custom mode table editor
// ---------------------------------------------------------------------------

interface EditorRow {
  key: string;
  model: string; // "provider/id" or "" when unset
  thinking?: string;
}

interface EditorDeps {
  tui: { requestRender(): void };
  theme: { fg(name: string, text: string): string };
  rows: EditorRow[];
  registry: {
    find(provider: string, id: string): Model<any> | undefined;
    getAvailable(): Model<any>[];
  };
  scopedModels: ReadonlyArray<{ model: Model<any>; thinkingLevel?: string }>;
  coreSelector: CoreModelSelector | null;
  done(result: { saved: boolean; mode: Mode } | undefined): void;
}

// Small selectable list used for thinking levels (and as the model-picker
// fallback when pi's selector cannot be loaded).
export class MiniList extends Container {
  private index = 0;
  private focused_ = false;

  get focused(): boolean {
    return this.focused_;
  }

  set focused(value: boolean) {
    this.focused_ = value;
  }

  constructor(
    private readonly theme: { fg(name: string, text: string): string },
    private readonly title: string,
    private readonly items: string[],
    private readonly onSelect: (value: string) => void,
    private readonly onCancel: () => void,
  ) {
    super();
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new Text(this.theme.fg("accent", this.title), 0, 0));
    this.addChild(new Spacer(1));
    this.items.forEach((item, i) => {
      const selected = i === this.index;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const label = selected ? this.theme.fg("accent", item) : item;
      this.addChild(new Text(`${prefix}${label}`, 0, 0));
    });
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.up")) {
      this.index = this.index === 0 ? this.items.length - 1 : this.index - 1;
      this.rebuild();
    } else if (kb.matches(data, "tui.select.down")) {
      this.index = this.index === this.items.length - 1 ? 0 : this.index + 1;
      this.rebuild();
    } else if (kb.matches(data, "tui.select.confirm")) {
      this.onSelect(this.items[this.index]!);
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel();
    }
  }
}

export class CustomModeEditor extends Container {
  // cursor 0 = "save & continue" row; 1..4 = agent rows. col: 0 = model, 1 = thinking.
  private cursor = 0;
  private col = 0;
  private flash = "";
  private editing: CoreSelectorComponent | null = null;
  private editingLabel = "";
  private focused_ = false;

  constructor(private readonly deps: EditorDeps) {
    super();
    this.rebuild();
  }

  get focused(): boolean {
    return this.focused_;
  }

  set focused(value: boolean) {
    this.focused_ = value;
    if (this.editing) this.editing.focused = value;
  }

  handleInput(data: string): void {
    if (this.editing) {
      this.editing.handleInput(data);
      return;
    }
    const kb = getKeybindings();
    const rowCount = this.deps.rows.length + 1;
    if (kb.matches(data, "tui.select.up")) {
      this.cursor = this.cursor === 0 ? rowCount - 1 : this.cursor - 1;
      this.flash = "";
      this.rebuild();
    } else if (kb.matches(data, "tui.select.down")) {
      this.cursor = this.cursor === rowCount - 1 ? 0 : this.cursor + 1;
      this.flash = "";
      this.rebuild();
    } else if (kb.matches(data, "tui.editor.cursorLeft")) {
      this.col = Math.max(0, this.col - 1);
      this.rebuild();
    } else if (kb.matches(data, "tui.editor.cursorRight")) {
      this.col = Math.min(1, this.col + 1);
      this.rebuild();
    } else if (kb.matches(data, "tui.select.confirm")) {
      if (this.cursor === 0) this.save();
      else this.startEdit();
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.deps.done(undefined);
    }
  }

  dispose(): void {
    this.editing?.dispose?.();
    this.editing = null;
  }

  private save(): void {
    const empty = this.deps.rows.find((row) => !row.model);
    if (empty) {
      this.flash = `pick a model for ${empty.key} first`;
      this.rebuild();
      return;
    }
    const pickOf = (row: EditorRow): Pick => {
      const pick: Pick = { model: row.model };
      if (row.thinking) pick.thinking = row.thinking;
      return pick;
    };
    const [main, ...rest] = this.deps.rows;
    const mode: Mode = {
      description: `custom picks · saved ${new Date().toISOString().slice(0, 10)}`,
      primary: pickOf(main!),
      agents: Object.fromEntries(rest.map((row) => [row.key, pickOf(row)])),
    };
    this.deps.done({ saved: true, mode });
  }

  private startEdit(): void {
    const row = this.deps.rows[this.cursor - 1]!;
    this.flash = "";
    if (this.col === 0) {
      this.editingLabel = `model for ${row.key}`;
      const finish = (id?: string): void => {
        if (id) row.model = id;
        this.backToTable();
      };
      if (this.deps.coreSelector) {
        const slash = row.model.indexOf("/");
        const current =
          row.model && slash > 0
            ? this.deps.registry.find(row.model.slice(0, slash), row.model.slice(slash + 1))
            : undefined;
        const picker = new this.deps.coreSelector(
          this.deps.tui,
          current,
          // Shim: never persist the picked model as the default model.
          { setDefaultModelAndProvider: () => {} },
          // ModelRuntime surface backed by the extension registry; refresh is
          // a no-op so the component just lists the current snapshot.
          {
            getAvailableSnapshot: () => this.deps.registry.getAvailable(),
            getModel: (provider: string, id: string) => this.deps.registry.find(provider, id),
            getError: () => undefined,
            refresh: async () => ({ errors: new Map() }),
          },
          this.deps.scopedModels,
          (model) => finish(`${model.provider}/${model.id}`),
          () => finish(),
        );
        this.attach(picker);
      } else {
        const items = this.deps.registry
          .getAvailable()
          .map((model) => `${model.provider}/${model.id}`)
          .sort();
        this.attach(
          new MiniList(this.deps.theme, this.editingLabel, items, finish, () => finish()),
        );
      }
    } else {
      this.editingLabel = `thinking for ${row.key}`;
      this.attach(
        new MiniList(
          this.deps.theme,
          this.editingLabel,
          [...THINKING_CHOICES],
          (value) => {
            row.thinking = value === "default" ? undefined : value;
            this.backToTable();
          },
          () => this.backToTable(),
        ),
      );
    }
  }

  private attach(child: CoreSelectorComponent): void {
    this.editing = child;
    child.focused = this.focused_;
    this.rebuild();
  }

  private backToTable(): void {
    // The core picker disposes itself before invoking callbacks; drop the ref.
    this.editing = null;
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new DynamicBorder());
    this.addChild(new Text(this.titleText(), 0, 0));
    this.addChild(new Spacer(1));
    if (this.editing) {
      this.addChild(this.editing);
    } else {
      this.renderTable();
    }
    this.addChild(new DynamicBorder());
    this.deps.tui.requestRender();
  }

  private titleText(): string {
    if (this.editing) {
      return `${this.deps.theme.fg("accent", "custom mode")}${this.deps.theme.fg("muted", ` — editing ${this.editingLabel} · enter select · esc back`)}`;
    }
    if (this.flash) {
      return this.deps.theme.fg("warning", this.flash);
    }
    return (
      this.deps.theme.fg("accent", "custom mode") +
      this.deps.theme.fg("muted", " — enter edit · ↑↓ row · ←→ cell · esc close")
    );
  }

  private renderTable(): void {
    const theme = this.deps.theme;
    const agentPad = Math.max(...AGENT_SLOTS.map((slot) => slot.key.length));
    const placeholder = "— pick a model —";
    const modelPad = Math.max(
      24,
      ...this.deps.rows.map((row) => (row.model || placeholder).length),
    );

    // Row 0: save & continue (cursor starts here so re-opening and hitting
    // enter immediately re-applies the saved mapping).
    const saveSelected = this.cursor === 0;
    const saveLabel = "save & continue";
    this.addChild(
      new Text(
        `${saveSelected ? theme.fg("accent", "→ ") : "  "}${theme.fg(
          saveSelected ? "accent" : "muted",
          saveLabel,
        )}`,
        0,
        0,
      ),
    );

    this.deps.rows.forEach((row, i) => {
      const selected = this.cursor === i + 1;
      const prefix = selected ? theme.fg("accent", "→ ") : "  ";
      const agent = (row.key || "").padEnd(agentPad);
      const agentText = theme.fg(selected ? "accent" : "muted", agent);
      const modelDisplay = (row.model || placeholder).padEnd(modelPad);
      const modelText = selected
        ? this.col === 0
          ? theme.fg("accent", modelDisplay)
          : theme.fg("muted", modelDisplay)
        : row.model
          ? modelDisplay
          : theme.fg("dim", modelDisplay);
      const thinkingDisplay = row.thinking ?? "default";
      const thinkingText = selected
        ? this.col === 1
          ? theme.fg("accent", thinkingDisplay)
          : theme.fg("muted", thinkingDisplay)
        : row.thinking
          ? thinkingDisplay
          : theme.fg("dim", thinkingDisplay);
      this.addChild(new Text(`${prefix}${agentText}  ${modelText}  ${thinkingText}`, 0, 0));
    });
  }
}

async function openCustomModeEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (!(ctx.hasUI && ctx.mode === "tui")) {
    ctx.ui.notify("/mode custom edit needs the interactive TUI", "error");
    return false;
  }

  const previous = await getMode(CUSTOM_MODE_NAME);
  let coreSelector: CoreModelSelector | null = null;
  try {
    coreSelector = await loadCoreModelSelector();
  } catch {
    ctx.ui.notify("model picker unavailable — using simple list", "warning");
  }

  const rows: EditorRow[] = AGENT_SLOTS.map((slot) => {
    const pick = slot.key === "main" ? previous?.primary : previous?.agents[slot.key];
    return { key: slot.key, model: pick?.model ?? "", thinking: pick?.thinking };
  });

  const result = await ctx.ui.custom<{ saved: boolean; mode: Mode } | undefined>(
    (tui, theme, _keybindings, done) =>
      new CustomModeEditor({
        tui,
        theme,
        rows,
        registry: ctx.modelRegistry,
        scopedModels: [...ctx.scopedModels],
        coreSelector,
        done,
      }),
  );

  if (!result?.saved) return false;
  await writeFile(CUSTOM_FILE, `${JSON.stringify(result.mode, null, 2)}\n`, "utf8");
  if (ctx.hasUI) ctx.ui.notify(`custom mode saved to ${CUSTOM_FILE}`, "info");
  await applyMode(pi, ctx, CUSTOM_MODE_NAME, true);
  return true;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Restore a persisted mode at startup so `keep` survives new pi instances.
  // Subagent children skip this: they already get model/thinking via the
  // parent's per-run override, and re-applying the primary pick here would
  // clobber e.g. a `fast` child's low thinking with the primary's level.
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.PI_SUBAGENT_CHILD === "1") return;
    try {
      const state = JSON.parse(await readFile(STATE_FILE, "utf8")) as { mode?: string };
      if (state && typeof state.mode === "string") {
        await applyMode(pi, ctx, state.mode, false);
      }
    } catch {
      // No state file (or unreadable) — config defaults apply.
    }
  });

  // Inject per-run overrides into every subagent launch (top precedence in
  // pi-subagents, so this outranks agent frontmatter without editing files).
  pi.on("tool_call", async (event) => {
    const mode = activeMode ? await getMode(activeMode) : undefined;
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
    const mode = activeMode ? await getMode(activeMode) : undefined;
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
      "Model preset for primary + subagents: /mode <openai|glm|custom> [keep], /mode off, or /mode for a picker (custom opens the table editor)",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
        ...Object.entries(MODES).map(([name, mode]) => ({
          value: name,
          label: `${name} — ${mode.description}`,
        })),
        {
          value: CUSTOM_MODE_NAME,
          label: "custom — open the table editor (pre-filled; enter, enter to re-apply)",
        },
        {
          value: "custom edit",
          label: "custom edit — same as /mode custom",
        },
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
      const namePart = parts.find((part) => part !== "keep" && part !== "edit");

      // No argument: show picker in TUI, otherwise just report status.
      if (!namePart) {
        if (ctx.hasUI && ctx.mode === "tui") {
          const current = activeMode ? `${activeMode} (active)` : "off (config defaults)";
          const choices = Object.keys(MODES).concat(CUSTOM_MODE_NAME, "off");
          const choice = await ctx.ui.select(`Switch mode — current: ${current}`, choices);
          if (choice === undefined) return;
          if (choice === "off") {
            await rm(STATE_FILE, { force: true });
            await clearMode(ctx, true);
          } else if (choice === CUSTOM_MODE_NAME) {
            // custom always opens the editor; it opens pre-filled with the
            // cursor on "save & continue", so re-applying the saved mapping
            // unchanged is just enter.
            if (await openCustomModeEditor(pi, ctx)) {
              await rm(STATE_FILE, { force: true }); // picker switches are session-local
            }
          } else if (await applyMode(pi, ctx, choice, true)) {
            await rm(STATE_FILE, { force: true }); // picker switches are session-local
          }
          return;
        }
        const mode = activeMode ? await getMode(activeMode) : undefined;
        ctx.ui.notify(mode ? modeSummary(activeMode!, mode) : "mode: off (config defaults)", "info");
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
          `/mode: unknown mode "${namePart}" — available: ${Object.keys(MODES).join(", ")}, custom, off`,
          "error",
        );
        return;
      }

      if (name === CUSTOM_MODE_NAME) {
        // custom always opens the editor ("edit" accepted as a no-op word).
        if (await openCustomModeEditor(pi, ctx)) {
          if (keep) {
            await writeFile(STATE_FILE, `${JSON.stringify({ mode: name }, null, 2)}\n`, "utf8");
            if (ctx.hasUI) ctx.ui.notify(`mode ${name} kept for future pi instances`, "info");
          } else {
            await rm(STATE_FILE, { force: true }); // switching without keep clears persistence
          }
        }
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
