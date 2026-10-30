// secret-mask — keep secret values out of model context.
//
// Model: scripts the agent runs (python/node/dotenv, bash `cat`, ...) keep
// working unchanged; nothing about execution is intercepted. But before any
// tool result enters the conversation, every known secret VALUE is replaced
// with `***` (default). Values are learned from the configured secret files
// (.env-style KEY=VALUE by default) plus a set of built-in token patterns
// (OpenAI/AWS/Slack/GitHub/Google keys, JWTs). Because scrubbing is
// value-based, it covers every leak path that ends in tool output:
//
//   - `read` tool on .env            → "KEY=***"
//   - bash `cat .env` / `printenv`   → values → ***
//   - grep/find output touching them → ***
//   - a script printing its env      → ***
//
// Not covered (by design): `!cmd` output the user runs themselves, and a
// deliberately obfuscated exfiltration (e.g. base64 of a secret printed by a
// hostile script). This protects against accidental leaks into context.
//
// Tool `details` (UI rendering + session logs) are scrubbed too so shared
// sessions/gists stay clean; the real values always remain in the files on
// disk.
//
// Config (both optional, merged: arrays concat, scalars project-wins):
//   ~/.pi/agent/secret-mask.json     global
//   .pi/secret-mask.json             project
// {
//   "secretFiles":   [".env", ".env.*", "**/.env", "**/.env.*"],
//   "extraPatterns": [],          // extra regex source strings
//   "builtinPatterns": true,      // known token formats
//   "minValueLength": 8,
//   "mask": "***"
// }
//
// `/secrets` shows what is being protected in this session.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import { isAbsolute, join, relative, resolve } from "node:path";

interface Config {
  secretFiles: string[];
  extraPatterns: string[];
  builtinPatterns: boolean;
  minValueLength: number;
  mask: string;
  maskAllValues: boolean;
  sensitiveKeyPatterns: string[];
}

const DEFAULTS: Config = {
  secretFiles: [".env", ".env.*", "**/.env", "**/.env.*"],
  extraPatterns: [],
  builtinPatterns: true,
  minValueLength: 8,
  mask: "***",
  maskAllValues: false,
  sensitiveKeyPatterns: [
    "(?:^|_)(?:key|token|secret|password|passwd|credential|credentials|authorization|cookie|cookies|access|refresh|bearer)(?:_|$)",
    "(?:^|_)(?:apikey|accesstoken|refreshtoken|clientsecret)(?:_|$)",
    "(?:^|_)private_key(?:_|$)",
  ],
};

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", ".venv", "venv", "__pycache__",
  "dist", "build", ".cache", ".next", "target", ".terraform",
]);
const WALK_DEPTH = 8;

// Known credential token formats (always substring-safe).
const BUILTIN_PATTERNS = [
  "sk-[A-Za-z0-9_-]{16,}", // OpenAI-style
  "sk-(?:live|test)_[A-Za-z0-9]{16,}", // Stripe
  "ghp_[A-Za-z0-9]{36}", // GitHub PAT
  "gho_[A-Za-z0-9]{36}", // GitHub OAuth
  "github_pat_[A-Za-z0-9_]{22,}", // GitHub fine-grained
  "AKIA[0-9A-Z]{16,}", // AWS access key id
  "xox[baprs]-[A-Za-z0-9-]{10,}", // Slack
  "AIza[0-9A-Za-z_-]{35}", // Google
  "eyJ[A-Za-z0-9_-]{20,}\\.eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}", // JWT
];

function loadConfigFile(path: string): Partial<Config> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    process.stderr.write(`secret-mask: failed to parse ${path}: ${err}\n`);
    return null;
  }
}

function mergeConfigs(globalCfg: Partial<Config> | null, projectCwd: string): Config {
  const projectCfg = loadConfigFile(join(projectCwd, ".pi", "secret-mask.json"));
  const g = globalCfg ?? {};
  const p = projectCfg ?? {};
  const secretFiles = [...new Set([...(g.secretFiles ?? []), ...(p.secretFiles ?? [])])];
  const extraPatterns = [...new Set([...(g.extraPatterns ?? []), ...(p.extraPatterns ?? [])])];
  return {
    secretFiles: secretFiles.length ? secretFiles : DEFAULTS.secretFiles,
    extraPatterns,
    builtinPatterns: p.builtinPatterns ?? g.builtinPatterns ?? DEFAULTS.builtinPatterns,
    minValueLength: p.minValueLength ?? g.minValueLength ?? DEFAULTS.minValueLength,
    mask: p.mask ?? g.mask ?? DEFAULTS.mask,
    maskAllValues: p.maskAllValues ?? g.maskAllValues ?? DEFAULTS.maskAllValues,
    sensitiveKeyPatterns: [...DEFAULTS.sensitiveKeyPatterns, ...(g.sensitiveKeyPatterns ?? []), ...(p.sensitiveKeyPatterns ?? [])],
  };
}

/** Convert a glob (*, **, ?) to a RegExp over posix-style relative paths. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**" (possibly "**/") — match across separators
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Bounded recursive walk matching the configured globs. */
function findSecretFiles(cwd: string, patterns: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const regexes = patterns.map((p) => ({ p, re: globToRegExp(p) }));

  const match = (rel: string): boolean =>
    regexes.some(({ p, re }) => {
      if (isAbsolute(p) || p.startsWith("~")) {
        const abs = p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
        return resolve(join(cwd, rel)) === abs;
      }
      return rel === p || re.test(rel);
    });

  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(cwd, full).split(/[\\/]/).join("/");
      if (e.isDirectory()) {
        if (depth >= WALK_DEPTH || SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && match(rel) && !seen.has(full)) {
        seen.add(full);
        found.push(full);
      }
    }
  };

  // Non-recursive patterns at cwd root are the common case; also allow plain
  // absolute / ~ paths without walking.
  for (const p of patterns) {
    if (isAbsolute(p) || p.startsWith("~")) {
      const abs = p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
      if (existsSync(abs) && statSync(abs).isFile() && !seen.has(abs)) {
        seen.add(abs);
        found.push(abs);
      }
    }
  }
  walk(cwd, 0);
  return found;
}

/** Ordinary .env configuration (URLs, selectors, model IDs) is not secret.
 * Credential keys and URLs containing userinfo are; token-format patterns
 * remain active independently of key classification. maskAllValues opts a
 * deliberately all-secret file set back into the old, indiscriminate policy. */
function isSensitive(key: string, value: string, config: Config): boolean {
  if (config.maskAllValues) return true;
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[.-]/g, "_").toLowerCase();
  if (config.sensitiveKeyPatterns.some((pattern) => {
    try { return new RegExp(pattern, "i").test(normalized); } catch { return false; }
  })) return true;
  try { const url = new URL(value); return Boolean(url.username || url.password); } catch { return false; }
}

/** Parse .env-style credential values without treating public config as secret. */
function parseEnvValues(text: string, minLen: number, config: Config): string[] {
  // Node's dotenv parser handles quoted/multiline values and inline comments;
  // hand-splitting lines can otherwise miss the actual credential bytes.
  const values: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (typeof value === "string" && value.length >= minLen && isSensitive(key, value, config)) values.push(value);
  }
  return values;
}

/** Parse a JSON secrets file (string/number leaf values at any depth).
 *  Returns the values worth masking plus the leaf key names they came
 *  from (for /secrets display). */
function parseJsonValues(text: string, minLen: number, config: Config): { values: string[]; keys: string[] } {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { values: [], keys: [] };
  }
  const values: string[] = [];
  const keys: string[] = [];
  const walk = (v: unknown, key?: string): void => {
    if (typeof v === "string") {
      if (v.length >= minLen && isSensitive(key ?? "", v, config)) {
        values.push(v);
        if (key) keys.push(key);
      }
    } else if (typeof v === "number") {
      const s = String(v);
      if (s.length >= minLen && isSensitive(key ?? "", s, config)) {
        values.push(s);
        if (key) keys.push(key);
      }
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) walk(child, key ? `${key}.${k}` : k);
    }
  };
  walk(obj);
  return { values, keys };
}

interface SecretSet {
  literals: string[]; // longest first
  regexes: RegExp[];
  sources: Map<string, string[]>; // file -> key names
}

let cache: { key: string; set: SecretSet } | null = null;
let redactions = 0;

async function buildSecretSet(cwd: string, config: Config): Promise<SecretSet> {
  const files = findSecretFiles(cwd, config.secretFiles);
  const statSig: string[] = [];
  for (const f of files) {
    try {
      const st = statSync(f);
      statSig.push(`${f}:${st.mtimeMs}:${st.size}`);
    } catch { statSig.push(`${f}:-`); }
  }
  const key = JSON.stringify([cwd, config, statSig]);
  if (cache && cache.key === key) return cache.set;

  const literals = new Set<string>();
  const sources = new Map<string, string[]>();
  for (const f of files) {
    try {
      const text = await readFile(f, "utf8");
      const isJson = f.endsWith(".json");
      if (isJson) {
        const parsed = parseJsonValues(text, config.minValueLength, config);
        for (const v of parsed.values) literals.add(v);
        sources.set(f, parsed.keys);
      } else {
        for (const v of parseEnvValues(text, config.minValueLength, config)) literals.add(v);
        sources.set(
          f,
          text.split(/\r?\n/).filter((l) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l))
            .map((l) => l.replace(/^\s*(?:export\s+)?/, "").split("=")[0].trim()),
        );
      }
    } catch { /* unreadable file — skip */ }
  }

  const regexes: RegExp[] = [];
  if (config.builtinPatterns) regexes.push(...BUILTIN_PATTERNS.map((p) => new RegExp(p, "g")));
  for (const p of config.extraPatterns) {
    try { regexes.push(new RegExp(p, "g")); } catch { /* bad user regex — ignore */ }
  }

  const set: SecretSet = {
    literals: [...literals].sort((a, b) => b.length - a.length),
    regexes,
    sources,
  };
  cache = { key, set };
  return set;
}

function scrubText(text: string, set: SecretSet, mask: string): { text: string; hits: number } {
  let out = text;
  let hits = 0;
  for (const lit of set.literals) {
    if (!out.includes(lit)) continue;
    const count = out.split(lit).length - 1;
    out = out.split(lit).join(mask);
    hits += count;
  }
  for (const re of set.regexes) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => { hits++; return mask; });
  }
  return { text: out, hits };
}

/** Replace every string in a details object (UI/session-log side). */
function scrubDetails(details: unknown, set: SecretSet, mask: string): { value: unknown; hits: number } {
  let hits = 0;
  const seen = new WeakMap<object, unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = scrubText(v, set, mask);
      hits += r.hits;
      return r.text;
    }
    if (v && typeof v === "object") {
      if (seen.has(v)) return seen.get(v);
      if (Array.isArray(v)) {
        const out: unknown[] = [];
        seen.set(v, out);
        for (const item of v) out.push(walk(item));
        return out;
      }
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return v;
      const out: Record<string, unknown> = {};
      seen.set(v, out);
      for (const [k, val] of Object.entries(v)) Object.defineProperty(out, k, { value: walk(val), enumerable: true, writable: true, configurable: true });
      return out;
    }
    return v;
  };
  return { value: walk(details), hits };
}

export default function secretMask(pi: ExtensionAPI) {
  let config = mergeConfigs(loadConfigFile(join(homedir(), ".pi", "agent", "secret-mask.json")), process.cwd());
  let sessionFiles: string[] = [];
  let sessionKeys: string[] = [];

  pi.on("session_start", async (_event, ctx) => {
    config = mergeConfigs(loadConfigFile(join(homedir(), ".pi", "agent", "secret-mask.json")), ctx.cwd);
    const set = await buildSecretSet(ctx.cwd, config);
    sessionFiles = [...set.sources.keys()].map((f) => relative(ctx.cwd, f) || f);
    sessionKeys = [...new Set([...set.sources.values()].flat())];
    if (sessionFiles.length) {
      ctx.ui.notify(
        `secret-mask: protecting ${sessionFiles.length} file(s), ${sessionKeys.length} secret value(s) — /secrets for details`,
        "info",
      );
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    const set = await buildSecretSet(ctx.cwd, config);
    if (!set.literals.length && !set.regexes.length) return;

    const result: { content?: typeof event.content; details?: unknown; structuredContent?: typeof event.structuredContent } = {};
    let changed = false;

    const newContent = event.content.map((c) => {
      if (c.type !== "text") return c;
      const r = scrubText(c.text, set, config.mask);
      if (!r.hits) return c;
      changed = true;
      redactions += r.hits;
      return { ...c, text: r.text };
    });
    if (changed) result.content = newContent;

    // Scrub JSON portions of built-in and custom-tool details without
    // destroying class instances, binary buffers or cyclic object graphs.
    if (event.details !== undefined && event.details !== null) {
      const d = scrubDetails(event.details, set, config.mask);
      if (d.hits) {
        redactions += d.hits;
        result.details = d.value;
        changed = true;
      }
    }

    // Redacting content alone makes Pi discard structuredContent. Keep both
    // representations consistent for programmatic/codemode consumers too.
    if ("structuredContent" in event && event.structuredContent !== undefined) {
      const structured = scrubDetails(event.structuredContent, set, config.mask);
      if (structured.hits || result.content) {
        result.structuredContent = structured.value as typeof event.structuredContent;
        redactions += structured.hits;
        changed = true;
      }
    }
    return changed ? result : undefined;
  });

  pi.registerCommand("secrets", {
    description: "Show secret-mask status (files, key names, redaction count — never values)",
    handler: async (_args, ctx) => {
      const set = await buildSecretSet(ctx.cwd, config);
      const lines = [
        "secret-mask",
        `  files:   ${sessionFiles.length ? sessionFiles.join(", ") : "(none found)"}`,
        `  keys:    ${sessionKeys.length ? sessionKeys.join(", ") : "(none)"}`,
        `  values:  ${set.literals.length} loaded, ${set.regexes.length} pattern(s)`,
        `  redactions this session: ${redactions}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
