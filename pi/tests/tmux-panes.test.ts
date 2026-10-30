import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiti } from "./helpers.ts";

const exec = promisify(execFile);
const { default: extension } = await jiti.import("../agent/extensions/tmux-panes.ts");

test("exact scripts, exit codes, scope, ownership and concurrent names on a private tmux server", { timeout: 20000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-tmux-test-"));
	const socket = join(dir, "socket");
	const original = { TMUX: process.env.TMUX, TMUX_PANE: process.env.TMUX_PANE, HERDR_ENV: process.env.HERDR_ENV };
	const tmux = async (args: string[]) => {
		try { const { stdout, stderr } = await exec("tmux", ["-S", socket, ...args], { timeout: 4000 }); return { stdout, stderr, code: 0 }; }
		catch (error: any) { return { stdout: error.stdout || "", stderr: error.stderr || "", code: error.code }; }
	};
	try {
		await writeFile(join(dir, "tmux.conf"), "set -g default-shell /bin/bash\n");
		assert.equal((await tmux(["-f", join(dir, "tmux.conf"), "new-session", "-d", "-s", "test", "-x", "160", "-y", "60", "sleep 60"])).code, 0);
		const self = (await tmux(["display-message", "-p", "-t", "test:0", "#{pane_id}"])).stdout.trim();
		process.env.TMUX = `${socket},0,0`;
		process.env.TMUX_PANE = self;
		delete process.env.HERDR_ENV;
		let tool: any;
		extension({ exec: async (command: string, args: string[]) => { assert.equal(command, "tmux"); return tmux(args); }, registerTool: (value: any) => { tool = value; } });
		const call = (params: any) => tool.execute("id", params, new AbortController().signal, undefined, { cwd: dir });
		const waitExit = async (name: string) => {
			for (let i = 0; i < 80; i++) {
				const result = await call({ action: "read", pane: name });
				if (!result.details.alive) return result;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			throw new Error("process did not exit");
		};
		const command = "python3 - <<'PY'\nfrom pathlib import Path\nPath('result').write_text(\"hello! 'quoted' \\\"double\\\" $HOME #id http://localhost:3000/\\n\")\nprint('multiline OK')\nPY\nexit 7";
		await call({ action: "run", pane: "script", command });
		const done = await waitExit("script");
		assert.equal(done.details.exitCode, "7");
		assert.match(done.content[0].text, /exited \(code 7\)/);
		assert.match(done.content[0].text, /multiline OK/);
		assert.doesNotMatch(done.content[0].text, /python3 -/);
		assert.equal(await readFile(join(dir, "result"), "utf8"), "hello! 'quoted' \"double\" $HOME #id http://localhost:3000/\n");
		await call({ action: "run", pane: "script", command: "printf replaced" });
		assert.match((await waitExit("script")).content[0].text, /replaced/);
		await call({ action: "stop", pane: "script" });
		const simultaneous = await Promise.allSettled([call({ action: "run", pane: "same", command: "sleep 30" }), call({ action: "run", pane: "same", command: "sleep 30" })]);
		assert.equal(simultaneous.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal(simultaneous.filter((r) => r.status === "rejected").length, 1);
		await call({ action: "stop", pane: "same" });
		// Foreign pane must neither be adopted by name nor resized/killed.
		const foreign = (await tmux(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", self, "sleep 30"])).stdout.trim();
		await tmux(["set-option", "-p", "-t", foreign, "@pi_name", "foreign"]);
		await assert.rejects(call({ action: "stop", pane: "foreign" }), /Owned pane.*not found/);
		await assert.rejects(call({ action: "run", pane: "safe", command: "true" }), /unrelated or legacy panes/);
		assert.match((await call({ action: "list" })).content[0].text, /unmanaged/);
		assert.equal((await tmux(["display-message", "-p", "-t", foreign, "#{pane_id}"])).stdout.trim(), foreign);
		await tmux(["kill-pane", "-t", foreign]);
		// Another session with the same tag is never addressed.
		await tmux(["new-session", "-d", "-s", "other", "sleep 30"]);
		const other = (await tmux(["display-message", "-p", "-t", "other:0", "#{pane_id}"])).stdout.trim();
		await tmux(["set-option", "-p", "-t", other, "@pi_name", "outside"]);
		await tmux(["set-option", "-p", "-t", other, "@pi_owner", self]);
		await assert.rejects(call({ action: "stop", pane: "outside" }), /not found/);
		await call({ action: "run", pane: "one", command: "sleep 30" });
		await call({ action: "run", pane: "two", command: "sleep 30" });
		await call({ action: "run", pane: "three", command: "sleep 30" });
		const panes = (await call({ action: "list" })).details.panes;
		assert.equal(panes.length, 3);
		assert(panes.every((p: any) => p.left === 80));
		assert(Math.max(...panes.map((p: any) => p.height)) - Math.min(...panes.map((p: any) => p.height)) <= 1);
		for (const p of panes) await call({ action: "stop", pane: p.name });
	} finally {
		for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
		await tmux(["kill-server"]);
		await rm(dir, { recursive: true, force: true });
	}
});
