---
name: opencode-env
description: Environment reference for editing opencode configuration on this machine. Use when changing agent models, variants, providers, fallback chains, or anything in the dotfiles opencode config (opencode.json, oh-my-opencode-slim.json, skills, prompt overrides). Covers the symlink layout, how to look up exact model slugs/auth/thinking levels before editing, which models are vision-capable, how omo-slim fallbacks work, and validation steps. Complements the built-in customize-opencode skill with machine-specific facts.
---

# OpenCode Environment Reference (this machine)

Machine-specific facts for editing opencode config on this host (Debian, `bergerj`).
Use this BEFORE changing models/variants/providers so edits are correct on the
first attempt. The built-in `customize-opencode` skill covers generic config
shape; this skill covers what is true on this machine.

## Symlink layout (do not create files in `.opencode/`)

- `~/.config/opencode` is a SYMLINK to `/home/bergerj/.dotfiles/opencode`
  (verified same inode). Editing the dotfiles copy edits the live config —
  there is only ONE file. Do not edit both copies separately.
- The dotfiles repo root is `/home/bergerj/.dotfiles`.
- There used to be a stray `.opencode/` dir in the dotfiles repo (untracked
  node package, images/, node_modules/). It was deleted as unneeded. Never
  create or edit files under a repo `.opencode/` dir — all opencode config
  lives under `opencode/` (repo) which is the symlinked `~/.config/opencode`.
- `opencode/` contains: `opencode.json` (core config), `oh-my-opencode-slim.json`
  (plugin config), `oh-my-opencode-slim/` (prompt override files),
  `skills/` (this and other skills), `dcp.jsonc`, `tui.json`, `node_modules/`.
- The active preset is `opencode-go` (set via `preset` key in
  `oh-my-opencode-slim.json`).
- Built-in agents in the preset: orchestrator, oracle, council, librarian,
  explorer, designer, fixer, observer, analyst. `disabled_agents: []`.
  Custom agents live under top-level `agents` (e.g. `agents.fullcontrol`,
  currently model `opencode-go/kimi-k2.7-code`, variant "none").
- Prompt overrides: `opencode/oh-my-opencode-slim/orchestrator_append.md`
  (flash-first delegation guidance; no model references in it).

## How to check model slugs, auth, and thinking levels (do this FIRST)

Never guess a model slug or variant from memory — the catalog changes often.
All facts below were verified with these commands:

```bash
# 1. All available model slugs (providers already configured)
opencode models

# 2. Which providers are authenticated (creds at ~/.local/share/opencode/auth.json)
opencode auth list

# 3. Full metadata cache: reasoning options (thinking levels), vision, context
jq -r '.["opencode-go"].models[] | "\(.id) | attach:\(.attachment) | efforts:\(.reasoning_options[0].values // []) | ctx:\(.limit.context)"' \
  ~/.cache/opencode/models.json
```

Key interpretation:
- `attachment: true` = vision-capable (can read images/PDFs). Used to pick
  observer/designer models.
- `reasoning_options[0].values` = valid `variant` values for that model
  (reasoning efforts like `high`, `max`). Setting a variant the model does not
  support is tolerated (no options applied), not fatal.
- `opencode auth list` shows 7 credentials on this machine: openai (oauth),
  opencode-go (api), github-copilot (oauth), neuralwatt (api), openrouter (api),
  gmicloud (api), deepinfra (api). So `openai/...` direct is usable.

## Current model inventory (verified Aug 2026)

`opencode-go` provider (the workhorse):

| Model | Vision | Efforts | Context |
|---|---|---|---|
| `opencode-go/kimi-k3` | yes (text+img+video) | `max` only | 1M |
| `opencode-go/kimi-k2.7-code` | yes | none | 262k (legacy, replaced by kimi-k3) |
| `opencode-go/glm-5.2` | no | high, max | 1M |
| `opencode-go/deepseek-v4-flash` | no | high, max | 1M |
| `opencode-go/deepseek-v4-pro` | no | high, max | 1M |
| `opencode-go/gpt-5.6-luna` | yes | none..max | 1.05M |

`openai` provider (direct, oauth):
- `openai/gpt-5.6-sol` — frontier, vision (text+img+pdf), efforts
  none/low/medium/high/xhigh/max, 1.05M ctx. Experimental modes exist as
  separate IDs (`openai/gpt-5.6-sol-fast`, `-pro` via openrouter only).
- Also available: `openai/gpt-5.6`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-luna`.

Other providers: `openrouter/moonshotai/kimi-k3` exists as an alternative route.

## omo-slim fallback chains (verified in plugin source)

The agent `model` field accepts a STRING **or an ARRAY** — an array is an
ordered fallback chain (schema: `AgentOverrideConfigSchema` in
`~/.cache/opencode/packages/oh-my-opencode-slim@latest/node_modules/oh-my-opencode-slim/dist/index.js`).

```json
{
  "oracle": {
    "model": ["openai/gpt-5.6-sol", "opencode-go/kimi-k3"],
    "variant": "high"
  }
}
```

- First entry is the primary model; remaining entries are tried in order when
  the primary fails with a failover error (429/403/outage). Retries default to
  3, configurable via top-level `fallback.enabled` / `fallback.maxRetries`.
- Entries may be `{ "id": "...", "variant": "..." }` objects; per-entry variants
  affect TUI resolution, while the agent-level `variant` field governs the
  actual session. On fallback replay the variant of the failed model is reused
  (missing variants are ignored, not fatal).
- Works identically in presets and for custom agents.

## Current model assignments (after Aug 2026 change)

- **oracle**: `["openai/gpt-5.6-sol", "opencode-go/kimi-k3"]`, variant `high`,
  skills `[simplify]`, mcps `[]`.
- **designer**: `opencode-go/kimi-k3`, variant `max` (kimi-k3 only supports
  `max`), skills `[agent-browser]`, mcps `[]`.
- **observer**: `opencode-go/kimi-k3`, no variant, skills `[]`, mcps `[]`.
- **fullcontrol** (custom agent, NOT in preset): `opencode-go/kimi-k2.7-code`,
  variant "none" — still legacy kimi; change it if user wants it on kimi-k3.

## Keeping things updated

- Upgrade the opencode binary: `opencode upgrade` (or `opencode upgrade <ver>`).
  Current installed version: 1.18.11 (binary at `~/.opencode/bin/opencode`).
- Plugin cache lives in `~/.cache/opencode/packages/` (e.g.
  `oh-my-opencode-slim@latest/`). `opencode.json` registers plugins
  `@tarquinen/opencode-dcp@latest` and `oh-my-opencode-slim`.
- After any config change: restart OpenCode (config/prompts/agents/skills/MCPs
  apply on next run).

## Validation checklist after edits

```bash
jq empty opencode/oh-my-opencode-slim.json opencode/opencode.json opencode/dcp.jsonc
```

- Both plugin config and core config are JSON (not JSONC) on this machine.
- Confirm the intended model slug exists via `opencode models` and the variant
  is in the model's `reasoning_options` before committing the edit.
- The dotfiles repo validates with the AGENTS.md checks (`git diff --check`,
  `bash -n` on scripts) when relevant.
