import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { refreshWayland } from "../agent/extensions/runtime-health/desktop.ts";
import { jiti, requirePi } from "./helpers.ts";

test("Wayland repair respects valid display, refuses ambiguous desktops and preserves X11/runtime", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-wayland-test-"));
	const servers: ReturnType<typeof createServer>[] = [];
	const socket = async (name: string) => {
		const server = createServer(); servers.push(server);
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(join(dir, name), resolve); });
	};
	try {
		await socket("wayland-77");
		const env = { XDG_RUNTIME_DIR: dir, DISPLAY: "localhost:10.0", WAYLAND_DISPLAY: "wayland-stale" };
		assert.equal(await refreshWayland(env), "wayland-77");
		assert.equal(env.DISPLAY, "localhost:10.0");
		assert.equal(env.XDG_RUNTIME_DIR, dir);
		assert.equal(env.WAYLAND_DISPLAY, "wayland-77");
		const clipboard = resolve("nvim/lua/core/clipboard.lua");
		await promisify(execFile)("nvim", ["--headless", "--clean", "--cmd", `lua dofile([[${clipboard}]])`,
			"-c", "lua assert(vim.env.WAYLAND_DISPLAY == 'wayland-77'); assert(vim.fn['provider#clipboard#Executable']() == 'wl-copy')", "-c", "qa!"],
			{ env: { ...process.env, ...env, WAYLAND_DISPLAY: "stale" }, timeout: 3000 });
		assert.equal(await refreshWayland(env), undefined);
		await socket("wayland-78");
		env.WAYLAND_DISPLAY = "stale";
		assert.equal(await refreshWayland(env), undefined);
		assert.equal(env.WAYLAND_DISPLAY, "stale");
		await promisify(execFile)("nvim", ["--headless", "--clean", "--cmd", `lua dofile([[${clipboard}]])`,
			"-c", "lua assert(vim.env.WAYLAND_DISPLAY == 'stale')", "-c", "qa!"], { env: { ...process.env, ...env }, timeout: 3000 });
	} finally {
		for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	}
});

test("compaction telemetry records success/failure without retaining provider error bodies", async () => {
	const { default: extension } = await jiti.import("../agent/extensions/runtime-health.ts");
	const handlers = new Map<string, any>();
	const entries: any[] = [];
	extension({ on: (name: string, fn: any) => handlers.set(name, fn), registerCommand() {}, appendEntry: (type: string, data: any) => entries.push({ type, data }) });
	const start = handlers.get("session_before_compact");
	start({ reason: "threshold", preparation: { tokensBefore: 12345 } }, { model: { provider: "test", id: "model" } });
	handlers.get("session_compact")({});
	start({ reason: "manual", preparation: { tokensBefore: 22222 } }, {});
	handlers.get("session_compact_failed")({ reason: "manual", aborted: false, errorMessage: "secret-provider-response" });
	assert.deepEqual(entries.map((e) => e.data.state), ["started", "completed", "started", "failed"]);
	assert.equal(entries[0].data.estimatedTokensBefore, 12345);
	assert(!JSON.stringify(entries).includes("secret-provider-response"));
});

test("installed Pi text print mode reports provider failure and exits nonzero (old TODO regression)", async () => {
	const packageRoot = requirePi.resolve("./package.json").replace(/\/package.json$/, "");
	const { runPrintMode } = await jiti.import(join(packageRoot, "dist/modes/print-mode.js"));
	const errors: string[] = [];
	const original = console.error;
	console.error = (message: unknown) => { errors.push(String(message)); };
	try {
		const session = { bindExtensions: async () => {}, subscribe: () => () => {}, prompt: async () => {},
			state: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "synthetic insufficient balance" }] } };
		const exit = await runPrintMode({ session, setRebindSession() {}, dispose: async () => {} }, { mode: "text", initialMessage: "synthetic" });
		assert.equal(exit, 1);
		assert.deepEqual(errors, ["synthetic insufficient balance"]);
	} finally { console.error = original; }
});
