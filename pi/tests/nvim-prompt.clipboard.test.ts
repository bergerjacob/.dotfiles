// Run: node --test pi/tests/nvim-prompt*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWaylandClipboard, saveClipboardImage, neovimClipboardStartup } from "../agent/extensions/nvim-prompt/clipboard.ts";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const png = Buffer.from("89504e470d0a1a0aff0080", "hex");

test("embedded Neovim chooses wl-copy instead of stale SSH xclip before startup", { skip: process.platform !== "linux", timeout: 8000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "nvim-prompt-provider-test-"));
	const server = createServer();
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(join(dir, "wayland-77"), resolve);
		});
		for (const staleDisplay of ["", "wayland-old"]) {
			await promisify(execFile)("nvim", ["--headless", "--clean", "--cmd", `lua ${neovimClipboardStartup}`,
				"-c", "lua assert(vim.env.WAYLAND_DISPLAY == 'wayland-77'); assert(vim.fn['provider#clipboard#Executable']() == 'wl-copy')", "-c", "qa!"], {
				env: { ...process.env, XDG_RUNTIME_DIR: dir, WAYLAND_DISPLAY: staleDisplay, DISPLAY: "localhost:10.0" }, timeout: 3000,
			});
		}
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	}
});

test("missing Wayland environment can use a discovered display; PNG stays binary", async () => {
	const calls: string[] = [];
	const value = await readWaylandClipboard({
		env: { DISPLAY: "localhost:10.0" }, displays: ["wayland-1"],
		run: async (args, env) => {
			calls.push(`${env.WAYLAND_DISPLAY}: ${args.join(" ")}`);
			return args.includes("--list-types") ? Buffer.from("text/plain\nimage/png\n") : png;
		},
	});
	assert.deepEqual(value, { kind: "image", bytes: png, extension: "png" });
	assert.deepEqual(calls, ["wayland-1: --list-types", "wayland-1: --no-newline --type image/png"]);
	const dir = await mkdtemp(join(tmpdir(), "nvim-prompt-clipboard-test-"));
	try {
		const path = await saveClipboardImage(value as Extract<NonNullable<typeof value>, { kind: "image" }>, dir);
		assert.deepEqual(await readFile(path), png);
		assert.equal((await stat(path)).mode & 0o777, 0o600);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("stale explicit Wayland display falls back to a working local display", async () => {
	const value = await readWaylandClipboard({
		env: { WAYLAND_DISPLAY: "wayland-old" }, displays: ["wayland-old", "wayland-1"],
		run: async (args, env) => {
			if (env.WAYLAND_DISPLAY === "wayland-old") throw new Error("cannot connect");
			return args.includes("--list-types") ? Buffer.from("image/png\n") : png;
		},
	});
	assert.equal(value?.kind, "image");
});

test("plain clipboard text remains a supported fallback", async () => {
	const value = await readWaylandClipboard({ displays: ["wayland-1"], run: async (args) => {
		return args.includes("--list-types") ? Buffer.from("text/plain;charset=utf-8\n") : Buffer.from("hello\n界");
	} });
	assert.deepEqual(value, { kind: "text", text: "hello\n界" });
});

test("unsupported/empty clipboard reports an error instead of silently doing nothing", async () => {
	await assert.rejects(readWaylandClipboard({ displays: ["wayland-1"], run: async () => Buffer.from("text/uri-list\n") }), /no supported image or text/);
	await assert.rejects(readWaylandClipboard({ displays: ["wayland-1"], run: async (args) => args.includes("--list-types") ? Buffer.from("image/png\n") : Buffer.alloc(0) }), /empty/);
});

test("no Wayland session leaves the X11/native fallback available", async () => {
	assert.equal(await readWaylandClipboard({ displays: [], run: async () => { throw new Error("should not run"); } }), undefined);
});

test("unavailable Wayland clipboard fails visibly and limits probes", async () => {
	let probes = 0;
	await assert.rejects(readWaylandClipboard({ displays: ["wayland-1", "wayland-2", "wayland-3", "wayland-4"], run: async () => {
		probes++;
		throw new Error("cannot connect");
	} }), /Cannot connect/);
	assert.equal(probes, 3);
});
