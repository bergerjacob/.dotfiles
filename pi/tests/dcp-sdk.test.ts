import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiti, requirePi } from "./helpers.ts";

// No network/auth: a scripted in-process provider drives the real SDK, extension
// runner, tool scheduler, persistence, usage accounting and stock footer.
test("real Pi requests shrink after compression and the stock footer follows provider usage", { timeout: 30000 }, async () => {
 const sdk = await jiti.import(requirePi.resolve("./dist/index.js"));
 const ai = await jiti.import("@earendil-works/pi-ai");
 const { Type } = await jiti.import("typebox");
 const { default: dcp } = await jiti.import("../agent/extensions/dcp/index.ts");
 const { initTheme } = await jiti.import(requirePi.resolve("./dist/modes/interactive/theme/theme.js"));
 initTheme("dark", false);
 const dir = await mkdtemp(join(tmpdir(), "dcp-sdk-"));
 let session: any;
 const requests: any[] = [], statuses = new Map<string, string>(), statusHistory: string[] = [], errors: any[] = [];
 const fixture = "UNCOMPRESSED-FIXTURE-" + "distinct fixture data ".repeat(3000);
 const parameters = { startToolCallId: "fixture-0", endToolCallId: "fixture-1", topic: "SDK fixture", summary: "SDK-KEPT-MARKER: the first two fixture reads completed; preserve this fact in the rewritten request." };
 let action: "script" | "finish" | "error" | "zero" = "script";
 try {
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerProvider("dcp-fixture", {
   api: "dcp-fixture", baseUrl: "https://offline-fixture.invalid", apiKey: "synthetic-not-a-credential",
   models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"], contextWindow: 300000, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
   streamSimple(model: any, context: any) {
    const request = structuredClone(context.messages); requests.push(request);
    const step = requests.length - 1;
    const input = request.reduce((n: number, m: any) => n + sdk.estimateTokens(m), 0);
    const content = action === "script" && step < 8 ? [{ type: "toolCall", id: `fixture-${step}`, name: "fixture_read", arguments: { index: step } }]
     : action === "script" && step === 8 ? [{ type: "toolCall", id: "compress-fixture", name: "compress", arguments: parameters }]
     : [{ type: "text", text: "finished" }];
    const message = { role: "assistant", content, provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(),
     stopReason: action === "error" ? "error" : content[0].type === "toolCall" ? "toolUse" : "stop",
     ...(action === "error" ? { errorMessage: "synthetic provider failure" } : {}),
     usage: { input: action === "zero" || action === "error" ? 0 : Math.floor(input / 4), output: action === "zero" || action === "error" ? 0 : 30,
      cacheRead: action === "zero" || action === "error" ? 0 : input - Math.floor(input / 4), cacheWrite: 0,
      totalTokens: action === "zero" || action === "error" ? 0 : input + 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = ai.createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push(action === "error" ? { type: "error", reason: "error", error: message } : { type: "done", reason: message.stopReason, message });
    stream.end(); return stream;
   },
  });
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
   noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
   systemPrompt: "Isolated DCP SDK fixture. Do not contact any service.", extensionFactories: [dcp] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime, resourceLoader: loader, settingsManager,
   model: modelRuntime.getModel("dcp-fixture", "scripted"), sessionManager: sdk.SessionManager.inMemory(dir),
   tools: ["fixture_read", "compress"], customTools: [{ name: "fixture_read", label: "fixture", description: "fixture", parameters: Type.Object({ index: Type.Number() }),
    execute: async (_id: string, params: any) => ({ content: [{ type: "text", text: `${params.index}: ${fixture}` }], details: {} }) }] }));
  await session.bindExtensions({ mode: "tui", onError: (e: any) => errors.push(e), uiContext: {
   setStatus(key: string, value?: string) { if (value === undefined) statuses.delete(key); else statuses.set(key, value); statusHistory.push(value ?? ""); },
   notify() {}, confirm: async () => true,
  } });
  const footer = new sdk.FooterComponent(session, { getGitBranch: () => "fixture-branch", getExtensionStatuses: () => statuses, getAvailableProviderCount: () => 1 });
  footer.setAutoCompactEnabled(false);
  const rendered: string[] = [], percentages: string[] = [];
  session.subscribe((event: any) => { if (event.type === "turn_end") {
   rendered.push(footer.render(200).join("\n")); percentages.push(session.getContextUsage().percent.toFixed(1));
  } });
  await session.prompt("Read eight fixtures, compress the first two, then finish.");
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 10);
  const before = requests[8].reduce((n: number, m: any) => n + sdk.estimateTokens(m), 0);
  const after = requests[9].reduce((n: number, m: any) => n + sdk.estimateTokens(m), 0);
  assert.ok(before - after > 25000, `real outgoing projection must shrink: ${before} -> ${after}`);
  const rewritten = requests[9].filter((m: any) => m.role === "toolResult" && ["fixture-0", "fixture-1"].includes(m.toolCallId));
  assert.equal(rewritten.length, 2);
  assert.equal(JSON.stringify(rewritten).split("SDK-KEPT-MARKER").length - 1, 1);
  assert.ok(!JSON.stringify(rewritten).includes(fixture));
  assert.ok(session.messages.some((m: any) => m.role === "toolResult" && m.toolCallId === "fixture-0" && m.content[0].text.includes(fixture)), "canonical original must remain intact");
  const expected = ((after + 30) / 300000 * 100).toFixed(1);
  assert.ok(footer.render(200).join("\n").includes(`${expected}%/300k`));
  assert.ok(rendered[8].includes(`${percentages[8]}%/300k`));
  assert.ok(Math.abs(Number(percentages[8]) - (before + 30) / 300000 * 100) < .5, "before a new response the stock footer keeps measured usage plus a small trailing-tool estimate");
  assert.ok(statusHistory.some(s => /context % pending response/.test(s)));
  assert.equal(statuses.get("dcp"), "DCP 1 active");
  assert.ok(footer.render(200).join("\n").includes("CH75.0%"), "stock cache statistics must survive");
  assert.ok(footer.render(200).join("\n").includes("fixture-branch"));

  action = "finish";
  await session.prompt("/dcp decompress 1");
  assert.match(statuses.get("dcp")!, /context % pending response/);
  await session.prompt("Measure the restored request.");
  const restored = requests.at(-1);
  assert.ok(restored.find((m: any) => m.toolCallId === "fixture-0").content[0].text.includes(fixture));
  const restoredPercent = session.getContextUsage().percent.toFixed(1);
  assert.ok(footer.render(200).join("\n").includes(`${restoredPercent}%/300k`));
  assert.ok(Number(restoredPercent) > Number(expected) + 8);
  assert.equal(statuses.get("dcp"), undefined);

  await session.prompt("/dcp recompress 1");
  action = "error";
  await session.prompt("Synthetic error must not clear the pending indicator.");
  assert.match(statuses.get("dcp")!, /context % pending response/);
  action = "zero";
  await session.prompt("Synthetic zero usage must not clear it either.");
  assert.match(statuses.get("dcp")!, /context % pending response/);
  action = "finish";
  await session.prompt("Measure the compressed request again.");
  assert.equal(statuses.get("dcp"), "DCP 1 active");
  assert.ok(footer.render(200).join("\n").includes(`${session.getContextUsage().percent.toFixed(1)}%/300k`));
  assert.deepEqual(errors, []);
 } finally {
  session?.dispose();
  await rm(dir, { recursive: true, force: true });
 }
});
