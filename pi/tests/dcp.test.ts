import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jiti, requirePi } from "./helpers.ts";
import { DEFAULT_CONFIG } from "../agent/extensions/dcp/vendor/lib/config.ts";
import { createSessionState } from "../agent/extensions/dcp/vendor/lib/state.ts";
import { rollingPolicy, actionablePolicy, resolveTargets, project, replay, nudge, estimateMessage, SUMMARY, REMINDER, ENTRY, type Message } from "../agent/extensions/dcp/core.ts";
const config = () => { const c = structuredClone(DEFAULT_CONFIG); c.strategies.deduplication.enabled = false; return c; };
const call = (id: string, name = "read", size = 3): Message => ({ role: "assistant", timestamp: 0, content: [{ type: "toolCall", id, name, arguments: { path: id, body: "x".repeat(size) } }] });
const result = (id: string, size = 3000, name = "read"): Message => ({ role: "toolResult", timestamp: 0, toolCallId: id, toolName: name, isError: false, content: [{ type: "text", text: "x".repeat(size) }] });
const loop = (n = 400): Message[] => [{ role: "user", content: "Original instructions: preserve this", timestamp: 0 }, ...Array.from({ length: n }, (_, i) => [call(`id${i}`), result(`id${i}`)]).flat()];
const freeze = (x: any) => { if (x && typeof x === "object") { Object.freeze(x); for (const y of Object.values(x)) freeze(y); } return x; };
const rec = { id: 1, createdAt: 0, toolCallIds: ["id0", "id1"], topic: "scan", summary: "Unique factual summary with paths and concrete decisions.", tokensSaved: 0, suspended: false };
const custom = (data: unknown) => ({ type: "custom", customType: ENTRY, data });
const branch = (messages: Message[]) => messages.map(message => ({ type: "message", message }));

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
 assert.equal(out.filter(x => x.customType === SUMMARY).length, 1);
 out = project(out, c, s, rollingPolicy(out, c)); assert.equal(out.filter(x => x.customType === SUMMARY).length, 1);
 const fresh = createSessionState(); replay(after, fresh, c); assert.deepEqual(fresh.compressions.get(1), rec);
 replay([...after, custom({ id: 1, suspended: true })], fresh, c); assert.equal(fresh.compressions.get(1)?.suspended, true);
 assert.equal(project(m, c, fresh, rollingPolicy(m, c)).filter(x => x.customType === SUMMARY).length, 0);
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
 const m = loop(); const ctx: any = { sessionManager: { getBranch: () => [...branch(m), ...entries], buildSessionProjection: () => ({ messages: m }) }, model: { contextWindow: 1000000 }, getSystemPrompt: () => "instructions", hasUI: false, ui: { notify() {} } };
 await hooks.get("session_start")({}, ctx); const out = await hooks.get("context")({ messages: m }, ctx); assert.ok(out.messages.length >= m.length);
 const t = tools[0]; const args = t.parameters.properties.toolCallIds ? { toolCallIds: ["id0", "id1"] } : { startToolCallId: "id0", endToolCallId: "id1" };
 const stored = await t.execute("compress0", { ...args, topic: rec.topic, summary: rec.summary }, undefined, undefined, ctx);
 assert.equal(stored.details.record.summary, rec.summary); assert.ok(entries.length); // durable before agent_end
 await command.handler("decompress 1", ctx); assert.equal(entries.at(-1).data.suspended, true);
});
