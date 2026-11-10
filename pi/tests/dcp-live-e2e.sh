#!/usr/bin/env bash
# Opt-in live check of the DCP extension in a real Pi process (makes real model requests).
# Run on the host, not in the tool sandbox:  bash pi/tests/dcp-live-e2e.sh
# It builds a throwaway project with tiny DCP thresholds, asks the model to read six data
# files, compress them with a range, then quote the compressed placeholder, and finally
# inspects the saved session. Exit 0 only if every check passes.
set -euo pipefail

dir="$(mktemp -d /tmp/dcp-e2e.XXXXXX)"
mkdir -p "$dir/.pi" "$dir/sessions" "$dir/data"
for i in 1 2 3 4 5 6; do
  for n in $(seq 1 400); do printf 'file%s line %s: distinct payload %s-%s-%s\n' "$i" "$n" "$i" "$n" "$((i * n * 7919))"; done > "$dir/data/file$i.txt"
done
cat > "$dir/.pi/dcp.json" <<'JSON'
{
  "rollingProtection": { "recentTokens": 3000, "maxWindowFraction": 0.4, "reserveTokens": 16384, "imageTokens": 4096 },
  "compress": { "minContextLimit": 4000, "maxContextLimit": 40000, "nudgeEveryTurns": 1, "nudgeFrequency": 1, "iterationNudgeThreshold": 3, "modelMinLimits": {}, "modelMaxLimits": {} }
}
JSON

prompt='This is an automated DCP end-to-end test. Follow the steps exactly.
1. With the bash tool, make six SEPARATE tool calls (one per call, sequentially): cat data/file1.txt, then file2.txt ... file6.txt.
2. When a DCP reminder lists eligible endpoints, call the compress tool once with startToolCallId and endToolCallId set to the first and last endpoint IDs from that reminder, and a factual summary that includes the exact marker ZEBRA-7731.
3. Then run: echo finished   with bash.
4. Final answer: quote verbatim the first 400 characters of the earliest tool result you can still see that begins with "[pi-dcp compression", and state whether ZEBRA-7731 appears in it. If there is none, say NONE.'

# DCP_E2E_MODE=<mode> pins a /mode preset (e.g. openai for the native provider path, claude-xl for
# claude-bridge) through a throwaway agent dir that symlinks everything except modes-state.json.
if [ -n "${DCP_E2E_MODE:-}" ]; then
  agent="$dir/agent"; mkdir -p "$agent"
  for entry in "$HOME"/.pi/agent/* "$HOME"/.pi/agent/.[!.]*; do
    [ -e "$entry" ] || continue
    case "$(basename "$entry")" in modes-state.json|sessions) continue ;; esac
    ln -s "$entry" "$agent/$(basename "$entry")"
  done
  printf '{"mode":"%s"}\n' "$DCP_E2E_MODE" > "$agent/modes-state.json"
  export PI_CODING_AGENT_DIR="$agent"
fi

cd "$dir"
echo "workdir: $dir mode: ${DCP_E2E_MODE:-<current>}"
PI_DCP_TRACE="$dir/trace.jsonl" timeout 900 pi --mode json -p --session-dir "$dir/sessions" "$prompt" > "$dir/out.jsonl" 2> "$dir/err.txt" || echo "pi exited $?"

node --input-type=module - "$dir" <<'NODE'
import { readdirSync, readFileSync } from "node:fs";
const dir = process.argv[2];
const file = readdirSync(`${dir}/sessions`).filter(f => f.endsWith(".jsonl")).map(f => `${dir}/sessions/${f}`)[0];
if (!file) { console.log("FAIL no session file"); process.exit(1); }
try { console.log("trace:\n" + readFileSync(`${dir}/trace.jsonl`, "utf8").split("\n").filter(Boolean).map(l => { const t = JSON.parse(l); return `  msgs=${t.messages} tokens=${t.tokens} eligible=${t.eligible} records=${t.records} nudged=${t.nudged}`; }).join("\n")); } catch { console.log("trace: none"); }
const entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const messages = entries.filter(e => e.type === "message").map(e => e.message);
const calls = messages.flatMap(m => m.role === "assistant" ? (m.content || []).filter(c => c.type === "toolCall") : []);
const results = messages.filter(m => m.role === "toolResult");
const compressResults = results.filter(m => m.toolName === "compress");
const text = m => (m.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
console.log("providers:", [...new Set(messages.filter(m => m.role === "assistant").map(m => `${m.provider}/${m.model}`))].join(", "));
const total = m => (m.usage?.input ?? 0) + (m.usage?.cacheRead ?? 0) + (m.usage?.cacheWrite ?? 0);
const assistants = messages.filter(m => m.role === "assistant");
const compressIdx = assistants.findIndex(m => (m.content || []).some(c => c.type === "toolCall" && c.name === "compress"));
const sizeAtCompress = compressIdx >= 0 ? total(assistants[compressIdx]) : 0;
const sizeAfter = compressIdx >= 0 && assistants[compressIdx + 1] ? total(assistants[compressIdx + 1]) : Infinity;
console.log(`request size at compress turn: ${sizeAtCompress}; next request: ${sizeAfter}`);
const last = [...messages].reverse().find(m => m.role === "assistant" && text(m).trim());
const checks = {
  "six data reads": calls.filter(c => c.name === "bash" && /file[1-6]\.txt/.test(JSON.stringify(c.arguments))).length >= 6,
  "compress called": calls.some(c => c.name === "compress"),
  "compress stored (not refused)": compressResults.some(m => !m.isError && !m.details?.refused && /Compression #\d+ stored/.test(text(m))),
  "record persisted in branch": entries.some(e => e.type === "custom" && e.customType === "dotfiles-dcp-v1" && e.data?.record?.summary?.includes("ZEBRA-7731")),
  "next request is smaller (compression reached the model)": sizeAfter < sizeAtCompress - 8000,
  "model quotes placeholder carrying the summary": !!last && /Summary of the compressed work-stream/.test(text(last)) && /ZEBRA-7731/.test(text(last)),
};
console.log("compress results:", compressResults.map(text));
console.log("final answer:\n" + (last ? text(last) : "(none)"));
let ok = true;
for (const [name, pass] of Object.entries(checks)) { console.log(pass ? "PASS" : "FAIL", name); ok &&= pass; }
process.exit(ok ? 0 : 1);
NODE
