import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jiti, requirePi } from "./helpers.ts";
import { DEFAULT_CONFIG } from "../agent/extensions/dcp/vendor/lib/config.ts";
import { createSessionState } from "../agent/extensions/dcp/vendor/lib/state.ts";
import { rollingPolicy, actionablePolicy, resolveTargets, resolveTargetsDetailed, notifyHistoryRewritten, BRIDGE_REBUILD_HOOKS, project, replay, nudge, estimateMessage, contextUsagePending, SUMMARY, REMINDER, ENTRY, type Message } from "../agent/extensions/dcp/core.ts";
const config = () => { const c = structuredClone(DEFAULT_CONFIG); c.strategies.deduplication.enabled = false; return c; };
const call = (id: string, name = "read", size = 3): Message => ({ role: "assistant", timestamp: 0, content: [{ type: "toolCall", id, name, arguments: { path: id, body: "x".repeat(size) } }] });
const result = (id: string, size = 3000, name = "read"): Message => ({ role: "toolResult", timestamp: 0, toolCallId: id, toolName: name, isError: false, content: [{ type: "text", text: "x".repeat(size) }] });
const loop = (n = 400): Message[] => [{ role: "user", content: "Original instructions: preserve this", timestamp: 0 }, ...Array.from({ length: n }, (_, i) => [call(`id${i}`), result(`id${i}`)]).flat()];
const freeze = (x: any) => { if (x && typeof x === "object") { Object.freeze(x); for (const y of Object.values(x)) freeze(y); } return x; };
const rec = { id: 1, createdAt: 0, toolCallIds: ["id0", "id1"], topic: "scan", summary: "Unique factual summary with paths and concrete decisions.", tokensSaved: 0, suspended: false };
const custom = (data: unknown) => ({ type: "custom", customType: ENTRY, data });
const shown = (out: Message[]) => JSON.stringify(out.map(x => x.content)).split(rec.summary).length - 1;
const branch = (messages: Message[]) => messages.map(message => ({ type: "message", message }));

test("pending footer usage replays per branch and requires a valid prompt measurement", () => {
 const measured = (usage: object, stopReason = "stop") => ({ type: "message", message: { ...call("response"), stopReason, usage } });
 const valid = measured({ input: 0, cacheRead: 500, output: 20 });
 const change = custom({ record: rec });
 assert.equal(contextUsagePending([]), false);
 assert.equal(contextUsagePending([valid, change]), true);
 for (const response of [measured({ input: 0, output: 0 }), measured({ input: 500 }, "error"), measured({ input: 500 }, "aborted"), measured({ input: 0, output: 500 })]) {
  assert.equal(contextUsagePending([valid, change, response]), true);
 }
 assert.equal(contextUsagePending([change, valid]), false);
 assert.equal(contextUsagePending([change, valid, custom({ id: 1, suspended: true })]), true);
 assert.equal(contextUsagePending([change, valid, custom({ manualMode: true })]), false);
 // Moving to the pre-rewrite branch must discard pending state without a cache.
 assert.equal(contextUsagePending([valid]), false);
});

test("huge one-user loop protects rolling suffix, not whole user turn; small windows scale", () => {
 const c = config(), m = loop(); const p = rollingPolicy(m, c, { contextWindow: 1000000 });
 assert.equal(p.budget, 100000); assert.ok(p.eligibleIds.includes("id0")); assert.ok(p.protectedIds.has("id399"));
 assert.ok(p.retained >= 100000); assert.ok(p.retained < 102000);
 const small = rollingPolicy(m, c, { contextWindow: 32000, maxTokens: 4096 }, 1000);
 assert.equal(small.budget, Math.floor((32000 - 16384 - 1000) * .4)); assert.ok(small.budget < p.budget);
 assert.equal(m[0].content, "Original instructions: preserve this");
});
test("crossing parallel batch, huge result and pending sibling are closed over paired IDs", () => {
 const c = config(); c.rollingProtection.recentTokens = 100;
 const a = call("a") as any; a.content.push((call("b") as any).content[0]);
 const m = [call("old"), result("old"), a, result("a", 90000), result("b", 1)];
 const p = rollingPolicy(m, c, { contextWindow: 1000000 });
 assert.ok(p.protectedIds.has("a")); assert.ok(p.protectedIds.has("b")); assert.ok(p.eligibleIds.includes("old"));
 const pending = rollingPolicy([a, result("a"), call("later"), result("later", 9000)], c);
 assert.ok(pending.protectedIds.has("a")); assert.ok(pending.protectedIds.has("b"));
 const huge = rollingPolicy([call("huge"), result("huge", 900000)], c); assert.ok(huge.retained > huge.budget); assert.ok(huge.protectedIds.has("huge"));
});
test("image placeholders, thinking, signatures and call arguments count", () => {
 assert.ok(estimateMessage(call("a", "read", 30000)) > 10000);
 assert.ok(estimateMessage({ role: "assistant", timestamp: 0, content: [{ type: "thinking", thinking: "x".repeat(30000), thinkingSignature: "sig" }] }) > 10000);
 assert.equal(estimateMessage({ role: "user", timestamp: 0, content: [{ type: "image", data: "opaque" }] }), 4112);
});
test("message, range, sweep eligibility and replay share one policy; atomic refusal", () => {
 const c = config(), m = loop(), p = rollingPolicy(m, c, { contextWindow: 1000000 });
 assert.deepEqual(resolveTargets(m, p, { toolCallIds: ["id0", "id1"] }), ["id0", "id1"]);
 assert.deepEqual(resolveTargets(m, p, { startToolCallId: "id0", endToolCallId: "id1" }), ["id0", "id1"]);
 assert.throws(() => resolveTargets(m, p, { toolCallIds: ["id0", "id399"] }), /atomic refusal.*Eligible endpoints/);
 const s = createSessionState(); s.compressions.set(1, { ...rec, toolCallIds: ["id0", "id399"] });
 const out = project(m, c, s, p); assert.deepEqual(out[2].content, m[2].content);
 const pinned = [call("pin", "write"), result("pin", 3000, "write"), ...m];
 assert.ok(!rollingPolicy(pinned, c).eligibleIds.includes("pin"));
});
test("many model requests nudge midloop beyond 64; manual/deny/no eligibility silence", () => {
 const c = config(), m = loop(), s = createSessionState(), p = rollingPolicy(m, c);
 c.compress.minContextLimit = 99999999; c.compress.iterationNudgeThreshold = 6;
 const fired: number[] = [];
 for (let i = 1; i <= 150; i++) { const out = nudge(m, c, s, p, {}); if (out.some(x => x.customType === REMINDER)) fired.push(i); }
 assert.equal(fired.length, 25); assert.equal(fired.at(-1), 150);
 s.manualMode = true; assert.equal(nudge(m, c, s, p, {}).length, m.length);
 s.manualMode = false; c.compress.permission = "deny"; assert.equal(nudge(m, c, s, p, {}).length, m.length);
});
test("fresh originals purge repeats with stable statistics and frozen inputs/pairing", () => {
 const c = config(), m = loop(); (m[2] as any).isError = true; (m[1] as any).content[0].arguments.body = "x".repeat(9000); freeze(m);
 const s = createSessionState(), p = rollingPolicy(m, c), a = project(m, c, s, p), stats = structuredClone(s.stats), b = project(m, c, s, p);
 assert.deepEqual((a[1] as any).content[0].arguments, { __purged: "[args purged by pi-dcp]" });
 assert.deepEqual((b[1] as any).content[0].arguments, (a[1] as any).content[0].arguments); assert.deepEqual(s.stats, stats);
 assert.equal((m[1] as any).content[0].arguments.body.length, 9000);
 assert.equal(a.length, m.length); assert.deepEqual(a.filter(x => x.role === "toolResult").map(x => x.toolCallId), m.filter(x => x.role === "toolResult").map(x => x.toolCallId));
});
test("summary exactly once across replay/reload/fork/projected contexts and durable suspension", () => {
 const c = config(), m = loop(), s = createSessionState(); const before = branch(m), after = [...before, custom({ record: rec })];
 replay(after, s, c); let out = project(m, c, s, rollingPolicy(m, c));
 assert.equal(shown(out), 1); assert.ok(!out.some(x => x.customType === SUMMARY));
 out = project(out, c, s, rollingPolicy(out, c)); assert.equal(shown(out), 1);
 const fresh = createSessionState(); replay(after, fresh, c); assert.deepEqual(fresh.compressions.get(1), rec);
 replay([...after, custom({ id: 1, suspended: true })], fresh, c); assert.equal(fresh.compressions.get(1)?.suspended, true);
 assert.equal(shown(project(m, c, fresh, rollingPolicy(m, c))), 0);
 replay([...after, custom({ id: 1, suspended: true }), custom({ id: 1, suspended: false })], fresh, c); assert.equal(fresh.compressions.get(1)?.suspended, false);
 replay(before, fresh, c); assert.equal(fresh.compressions.size, 0); replay(after, fresh, c); assert.equal(fresh.compressions.size, 1);
});
test("legacy success migration and full details survive branch replay without external cache", () => {
 const c = config(), m = loop(); const compress = call("compress0", "compress") as any;
 compress.content[0].arguments = { toolCallIds: rec.toolCallIds, topic: rec.topic, summary: rec.summary };
 const success = result("compress0", 1, "compress") as any; success.details = { compressionId: 1, resolvedToolCallIds: rec.toolCallIds };
 const s = createSessionState(); replay(branch([...m, compress, success]), s, c); assert.equal(s.compressions.get(1)?.summary, rec.summary);
 const out = project([...m, compress, success], c, s, rollingPolicy(m, c));
 assert.equal(JSON.stringify(out.map(x => x.content)).split(rec.summary).length - 1, 1);
 success.details = { record: rec }; replay(branch([success]), s, c); assert.equal(s.compressions.get(1)?.summary, rec.summary);
 success.isError = true; replay(branch([success]), s, c); assert.equal(s.compressions.size, 0);
});
test("Pi custom/bash/branch-summary messages budget and normalize without breaking pairs", async () => {
 const { convertToLlm } = await import(requirePi.resolve("./dist/core/messages.js"));
 const c = config(), m = loop();
 m.push({ role: "bashExecution", command: "pwd", output: "x".repeat(30000), timestamp: 0 } as unknown as Message);
 m.push({ role: "branchSummary", summary: "keep decisions", timestamp: 0 } as unknown as Message);
 m.push({ role: "compactionSummary", summary: "older decisions", timestamp: 0 } as unknown as Message);
 assert.ok(estimateMessage(m.at(-3)!) > 10000);
 const s = createSessionState(); s.compressions.set(1, rec);
 const out = project(m, c, s, rollingPolicy(m, c));
 const normalized = convertToLlm(out);
 const ids = normalized.filter((x: any) => x.role === "toolResult").map((x: any) => x.toolCallId);
 assert.equal(ids.length, 400); assert.equal(new Set(ids).size, 400);
 assert.equal(JSON.stringify(normalized.map((x: any) => x.content)).split(rec.summary).length - 1, 1);
});
test("real Pi extension loader resolves only host dependencies without local node_modules", async () => {
 const { loadExtensions } = await import(requirePi.resolve("./dist/core/extensions/loader.js"));
 const loaded = await loadExtensions([new URL("../agent/extensions/dcp/index.ts", import.meta.url).pathname], process.cwd());
 assert.deepEqual(loaded.errors, []); assert.equal(loaded.extensions.length, 1);
 assert.deepEqual([...loaded.extensions[0].tools.keys()], ["compress"]);
});
test("already compressed records are not repeatedly offered as reclaimable work", () => {
 const c = config(), m = loop(), p = rollingPolicy(m, c), s = createSessionState();
 s.compressions.set(1, { ...rec, toolCallIds: [...p.eligibleIds] });
 const available = actionablePolicy(p, m, s); assert.equal(available.eligibleIds.length, 0); assert.equal(available.savings, 0);
 assert.throws(() => resolveTargets(m, available, { toolCallIds: ["id0"] }), /atomic refusal/);
 const pinned = call("skill", "read") as any; pinned.content[0].arguments.path = "/some/skills/hello/SKILL.md";
 assert.ok(rollingPolicy([pinned, result("skill"), ...m], c).protectedIds.has("skill"));
});
test("integration smoke registers exactly one compress and request hook, no model network", async () => {
 const settings = JSON.parse(readFileSync(new URL("../agent/settings.json", import.meta.url), "utf8"));
 const pkg = settings.packages.find((x: any) => x.source?.includes("@davecodes/pi-dcp")); assert.deepEqual(pkg.extensions, []); assert.equal(settings.compaction.enabled, false);
 const factory = (await jiti.import("../agent/extensions/dcp/index.ts", { default: true })) as (pi: any) => void;
 const hooks = new Map<string, any>(); const tools: any[] = []; const entries: any[] = []; let command: any;
 factory({ on: (name: string, fn: any) => hooks.set(name, fn), registerTool: (tool: any) => tools.push(tool), registerCommand: (_name: string, value: any) => command = value, appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }) });
 assert.equal(tools.filter(t => t.name === "compress").length, 1); assert.ok(hooks.has("context")); assert.ok(!hooks.has("before_agent_start"));
 const m = loop(); const ctx: any = { sessionManager: { getSessionId: () => "smoke-session", getBranch: () => [...branch(m), ...entries], buildSessionProjection: () => ({ messages: m }) }, model: { contextWindow: 1000000 }, getSystemPrompt: () => "instructions", hasUI: false, ui: { notify() {} } };
 await hooks.get("session_start")({}, ctx); const out = await hooks.get("context")({ messages: m }, ctx); assert.ok(out.messages.length >= m.length);
 const t = tools[0]; const args = t.parameters.properties.toolCallIds ? { toolCallIds: ["id0", "id1"] } : { startToolCallId: "id0", endToolCallId: "id1" };
 const stored = await t.execute("compress0", { ...args, topic: rec.topic, summary: rec.summary }, undefined, undefined, ctx);
 assert.equal(stored.details.record.summary, rec.summary); assert.ok(entries.length); // durable before agent_end
 const seen: unknown[][] = []; (globalThis as any)[BRIDGE_REBUILD_HOOKS] = new Set([(s: string, e: string) => seen.push([s, e])]);
 try { await command.handler("decompress 1", ctx); assert.equal(entries.at(-1).data.suspended, true); assert.deepEqual(seen, [["smoke-session", "dcp:decompress"]]); } finally { delete (globalThis as any)[BRIDGE_REBUILD_HOOKS]; }
 // A context without session identity still compresses.
 delete ctx.sessionManager.getSessionId; const again = await t.execute("compress1", { ...args, topic: "again", summary: rec.summary }, undefined, undefined, ctx); assert.ok(again.details.record);
});

test("range mode skips pinned/protected/compressed calls inside it and clips at the protected suffix; explicit IDs stay strict", () => {
 const c = config(), base = loop();
 const m = [...base.slice(0, 5), call("pin", "write"), result("pin", 3000, "write"), call("bash1", "bash"), result("bash1"), ...base.slice(5)];
 const p = rollingPolicy(m, c, { contextWindow: 1000000 });
 assert.ok(!p.eligibleIds.includes("pin"));
 const r = resolveTargetsDetailed(m, p, { startToolCallId: "id0", endToolCallId: "bash1" });
 assert.deepEqual(r.ids, ["id0", "id1", "bash1"]); assert.equal(r.skipped, 1);
 const tail = resolveTargetsDetailed(m, p, { startToolCallId: "id0", endToolCallId: "id399" });
 assert.ok(tail.ids.includes("id0") && !tail.ids.includes("id399") && tail.skipped > 0);
 assert.throws(() => resolveTargets(m, p, { startToolCallId: "id0", endToolCallId: "nope" }), /endpoint_not_found.*nope/);
 assert.throws(() => resolveTargets(m, p, { startToolCallId: "id399", endToolCallId: "id398" }), /no_eligible_results/);
 assert.throws(() => resolveTargets(m, p, { toolCallIds: ["id0", "pin", "ghost"] }), /atomic refusal.*unknown: ghost.*pin/);
 const s = createSessionState(); s.compressions.set(1, { ...rec, toolCallIds: ["id0", "id1"] });
 const again = resolveTargetsDetailed(m, actionablePolicy(p, m, s), { startToolCallId: "id0", endToolCallId: "id3" });
 assert.deepEqual(again.ids, ["bash1", "id2", "id3"]); assert.equal(again.skipped, 3);
});

test("summary renders in place on the first result of a record, later results only point to it", () => {
 const c = config(), m = loop(), s = createSessionState();
 s.compressions.set(1, { ...rec, toolCallIds: ["id2", "id0", "id1"] });
 const out = project(m, c, s, rollingPolicy(m, c, { contextWindow: 1000000 }));
 const texts = out.filter(x => (x as any).toolCallId && ["id0", "id1", "id2"].includes((x as any).toolCallId)).map(x => (x.content as any)[0].text as string);
 assert.ok(texts[0].includes(rec.summary) && texts[0].includes("#1: scan"));
 assert.ok(!texts[1].includes(rec.summary) && /first result of compression #1/.test(texts[1]) && !texts[2].includes(rec.summary));
 assert.ok(!out.some(x => x.role === "custom"));
 // A record that cannot apply (protected target) shows no summary and leaves originals intact.
 s.compressions.set(2, { ...rec, id: 2, summary: "Second record summary with enough characters.", toolCallIds: ["id0", "id399"] });
 const again = project(m, c, s, rollingPolicy(m, c, { contextWindow: 1000000 }));
 assert.equal(JSON.stringify(again).includes("Second record summary"), false);
});
test("no eligible results never turns soft context pressure into a stop/handoff instruction", () => {
 const c = config(), model = { contextWindow: 100000 };
 c.compress.minContextLimit = "50%"; c.compress.maxContextLimit = "75%";
 for (const fraction of [.68, .75, .99, 1.1]) {
  // Pinned/prose-only growth can exceed an estimate without any actionable output.
  const m: Message[] = [{ role: "user", timestamp: 0, content: "x".repeat(model.contextWindow * fraction * 3) }];
  const p = rollingPolicy(m, c, model), s = createSessionState();
  assert.equal(p.eligibleIds.length, 0);
  for (let i = 0; i < 40; i++) assert.equal(nudge(m, c, s, p, model), m);
 }
 // Exhausting all eligible outputs through real compression must also stay silent.
 const m = loop(), s = createSessionState(), p = rollingPolicy(m, c, model);
 s.compressions.set(1, { ...rec, toolCallIds: [...p.eligibleIds] });
 const available = actionablePolicy(p, m, s), projected = project(m, c, s, p);
 assert.equal(available.eligibleIds.length, 0);
 assert.equal(nudge(projected, c, s, available, model), projected);
});

test("manual, denied and zero-savings compression remain silent even above the soft ceiling", () => {
 const c = config(), m = loop(), p = rollingPolicy(m, c), s = createSessionState();
 c.compress.maxContextLimit = 1;
 s.manualMode = true; assert.equal(nudge(m, c, s, p, {}), m);
 s.manualMode = false; c.compress.permission = "deny"; assert.equal(nudge(m, c, s, p, {}), m);
 c.compress.permission = "allow"; assert.equal(nudge(m, c, s, { ...p, savings: 0 }, {}), m);
 c.compress.nudgeFrequency = 1;
 const text = String(nudge(m, c, s, p, {}).at(-1)?.content);
 assert.match(text, /context pressure high/);
 assert.match(text, /not a stop signal/);
 assert.match(text, /continue the task/);
 assert.doesNotMatch(text, /write a.*handoff|tell the user to continue in a fresh session/);
});

test("skill reads survive compression, deduplication and repeated projection verbatim", () => {
 const c = config(); c.strategies.deduplication.enabled = true;
 const skill = readFileSync(new URL("../agent/skills/pi-dcp/SKILL.md", import.meta.url), "utf8");
 const a = call("skill-a") as any, b = call("skill-b") as any;
 a.content[0].arguments = b.content[0].arguments = { path: "/skills/pi-dcp/SKILL.md" };
 const first = result("skill-a") as any, second = result("skill-b") as any;
 first.content[0].text = second.content[0].text = skill;
 const m = [a, first, b, second, ...loop()], p = rollingPolicy(m, c), s = createSessionState();
 assert.ok(p.protectedIds.has("skill-a") && p.protectedIds.has("skill-b"));
 assert.throws(() => resolveTargets(m, p, { toolCallIds: ["skill-a"] }), /atomic refusal/);
 s.compressions.set(1, { ...rec, toolCallIds: [...p.eligibleIds] });
 let out = m;
 for (let i = 0; i < 2; i++) {
  out = project(out, c, s, rollingPolicy(out, c));
  for (const id of ["skill-a", "skill-b"]) assert.equal((out.find(x => x.toolCallId === id)?.content as any)[0].text, skill);
 }
});

test("only the fork-matching local DCP skill is enabled and discoverable", async () => {
 const settings = JSON.parse(readFileSync(new URL("../agent/settings.json", import.meta.url), "utf8"));
 const pkg = settings.packages.find((x: any) => x.source?.includes("@davecodes/pi-dcp"));
 assert.deepEqual(pkg.skills, []);
 const { loadSkillsFromDir } = await jiti.import(requirePi.resolve("./dist/core/skills.js"));
 const loaded = loadSkillsFromDir({ dir: new URL("../agent/skills/pi-dcp", import.meta.url).pathname, source: "test" });
 assert.deepEqual(loaded.diagnostics, []);
 assert.equal(loaded.skills.length, 1); assert.equal(loaded.skills[0].name, "pi-dcp");
 assert.match(loaded.skills[0].description, /No eligible results does not mean context is full/);
});

test("compression changes notify pi-claude-bridge so the rewritten history reaches the model; no-op without it", () => {
 const g = globalThis as Record<symbol, unknown>, saved = g[BRIDGE_REBUILD_HOOKS];
 try {
  delete g[BRIDGE_REBUILD_HOOKS]; assert.equal(notifyHistoryRewritten("s1", "dcp:compress"), 0);
  const calls: unknown[][] = []; g[BRIDGE_REBUILD_HOOKS] = new Set([(s: string | null, e: string) => { calls.push([s, e]); }, () => { throw new Error("faulty hook"); }]);
  assert.equal(notifyHistoryRewritten("s1", "dcp:compress"), 1); assert.deepEqual(calls, [["s1", "dcp:compress"]]);
  assert.equal(notifyHistoryRewritten(undefined, "dcp:sweep"), 1); assert.deepEqual(calls.at(-1), [null, "dcp:sweep"]);
 } finally { if (saved === undefined) delete g[BRIDGE_REBUILD_HOOKS]; else g[BRIDGE_REBUILD_HOOKS] = saved; }
});
