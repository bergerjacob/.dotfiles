import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { jiti } from "./helpers.ts";
import { routeWorkflow, filterAgentList } from "../agent/extensions/mode-routing/workflow.ts";

const mode = { primary: { model: "test/main" }, agents: {
	fast: { model: "test/fast", thinking: "low" }, standard: { model: "test/standard", thinking: "medium" },
	oracle: { model: "test/oracle", thinking: "high" }, vision: null,
} };
const aliases = { cheap: "fast", medium: "standard", eyes: "vision" };
// Test the installed script validator, VM and promise-observation tracker;
// launch is fake, so these checks never make a model/network request.
const { runWorkflowScript } = await jiti.import(join(homedir(), ".pi/agent/npm/node_modules/pi-subagents/src/workflows/scripted-workflow.ts"));
async function run(script: string, explicitModel?: string, failKeys: string[] = []) {
	const calls: any[] = [];
	const result = await runWorkflowScript({ script: routeWorkflow(script, mode, aliases, "test", explicitModel), timeoutMs: 3000,
		launch: async (key: string, params: any) => { calls.push({ key, ...params }); return { key, ok: !failKeys.includes(key), output: "synthetic output", artifactPaths: [] }; },
		status: async () => { throw new Error("unexpected status call"); },
	});
	return { calls, result };
}

test("runtime routes helpers, computed/spread specs and aliases; mixed explicit models stay explicit", async () => {
	const { calls } = await run(`
const agent = 'cheap';
const T = (key, a) => ({ key, ...{ agent: a }, task: 'prose: {agent: "vision", model: "unrelated"}' });
const results = await runs.all([T('a', agent), { ...T('b', 'oracle'), model: 'explicit/child' }, T('c', 'standard'), T('d', 'project-agent')]);
return results.map(r => r.ok);`);
	assert.equal(calls[0].model, "test/fast:low");
	assert.equal(calls[1].model, "explicit/child");
	assert.equal(calls[2].model, "test/standard:medium");
	assert.equal(calls[3].model, undefined);
});

test("explicit top-level model wins without overriding a child's explicit model", async () => {
	const { calls } = await run(`return await runs.all([{key:'a',agent:'fast',task:'x'}, {key:'b',agent:'oracle',model:'explicit/child',task:'x'}]);`, "explicit/top");
	assert.equal(calls[0].model, undefined, "host inherits explicit top-level default");
	assert.equal(calls[1].model, "explicit/child");
});

test("dynamic disabled aliases fail before any child starts in a batch", async () => {
	await assert.rejects(run(`const a = 'eyes'; return await runs.all([{key:'a',agent:'fast',task:'x'},{key:'b',agent:a,task:'x'}]);`), /vision.*disabled/);
	await assert.rejects(run(`const a = 'vision'; return await runs.run('a', {agent:a,task:'x',model:'explicit/vision'});`), /vision.*disabled/);
});

test("resume objects, strings/comments and single-child returned promises retain semantics", async () => {
	const { calls, result } = await run(`// {agent:'vision', model:'not a launch'}
const task = "{agent:'vision'}";
await runs.run('a', {resume:'retained-id',task});
return runs.run('b', {agent:'fast',task});`);
	assert.equal(calls[0].resume, "retained-id");
	assert.equal(calls[0].model, undefined);
	assert.equal(calls[1].model, "test/fast:low");
	assert.equal(result.value.key, "b");
});

test("replayed routing is idempotent and can apply a newly selected mode", async () => {
	const script = "return runs.run('a', {agent:'fast',task:'x'});";
	const once = routeWorkflow(script, mode, aliases, "test");
	assert.equal(routeWorkflow(once, mode, aliases, "test"), once);
	const changed = { ...mode, agents: { ...mode.agents, fast: { model: "new/fast" } } };
	assert.equal(routeWorkflow(once, changed, aliases, "changed"), routeWorkflow(script, changed, aliases, "changed"));
	assert.equal((await run(once)).calls[0].model, "test/fast:low");
});

test("disabled agents move out of executable discovery without restricting project agents", () => {
	const text = "Executable agents:\n- fast (user): cheap\n- vision (user): eyes\n- project-agent (project): custom";
	const filtered = filterAgentList(text, mode, aliases, "test");
	assert.doesNotMatch(filtered.split("Disabled in mode")[0], /- vision/);
	assert.match(filtered, /Disabled in mode test \(not executable\):\n- vision/);
	assert.match(filtered.split("Disabled in mode")[0], /project-agent/);
	assert.equal(filterAgentList("ordinary output", mode, aliases, "test"), "ordinary output");
});


test("all-failed fanout rejects before dependent stages; mixed results and explicit recovery work", async () => {
 const script = `const results = await runs.all([{key:'a',agent:'fast',task:'x'},{key:'b',agent:'standard',task:'x'}]); return results.map(r => r.ok);`;
 await assert.rejects(run(script, undefined, ['a', 'b']), /All workflow children failed: a, b/);
 const mixed = await run(script, undefined, ['a']);
 assert.deepEqual(mixed.result.value, [false, true]);
 const recovered = await run(`try { await runs.all([{key:'a',agent:'fast',task:'x'}]); } catch(error) { return 'intentional recovery'; }`, undefined, ['a']);
 assert.equal(recovered.result.value, 'intentional recovery');
});
