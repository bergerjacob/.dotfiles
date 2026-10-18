// Run: node --test pi/tests/nvim-prompt*.test.ts
// Requires the installed @bizmyth/pi-neovim-editor and Neovim >= 0.10.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { readLinuxClipboard } from "../agent/extensions/nvim-prompt/clipboard.ts";

const globalModules = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const requirePi = createRequire(join(globalModules, "@earendil-works/pi-coding-agent/package.json"));
const packageDir = process.env.PI_NVIM_EDITOR_DIR ?? join(homedir(), ".pi/agent/npm/node_modules/@bizmyth/pi-neovim-editor");
const installed = existsSync(join(packageDir, "src/editor.ts"));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createEditor(width: number, realClipboard = false) {
	const requireNvim = createRequire(join(packageDir, "package.json"));
	const { createJiti } = requirePi("jiti");
	const jiti = createJiti(import.meta.url, { alias: {
		"@earendil-works/pi-tui": requirePi.resolve("@earendil-works/pi-tui"),
		"@msgpack/msgpack": requireNvim.resolve("@msgpack/msgpack"),
	} });
	const { NeovimEditor } = await jiti.import(join(packageDir, "src/editor.ts"));
	const { default: nvimPrompt } = await jiti.import("../agent/extensions/nvim-prompt.ts");
	const { matchesKey, visibleWidth } = await jiti.import(requirePi.resolve("@earendil-works/pi-tui"));
	let editor: any;
	let disposed = false;
	let scheduled = false;
	let hardwareCursor = false;
	const errors: string[] = [];
	const submitted: string[] = [];
	let clipboardPastes = 0;
	let lines: string[] = [];
	const render = () => {
		if (disposed || !editor) return;
		lines = editor.render(width);
		for (const line of lines) assert(visibleWidth(line) <= width, "render overflow");
	};
	const tui = {
		terminal: { rows: 24, write() {} },
		getShowHardwareCursor: () => hardwareCursor,
		setShowHardwareCursor: (value: boolean) => { hardwareCursor = value; },
		requestRender: () => {
			if (scheduled || disposed) return;
			scheduled = true;
			setTimeout(() => { scheduled = false; render(); }, 1);
		},
	};
	const identity = (text: string) => text;
	const theme = { borderColor: identity, selectList: new Proxy({}, { get: () => identity }) };
	const keys: Record<string, string> = {
		"app.clipboard.pasteImage": "ctrl+v", "tui.input.submit": "enter", "tui.input.newLine": "shift+enter",
		"tui.input.tab": "tab", "tui.select.confirm": "enter", "tui.select.cancel": "escape",
	};
	const keybindings = { matches: (data: string, action: string) => !!keys[action] && matchesKey(data, keys[action]) };
	let factory: any = () => {
		editor = new NeovimEditor(tui, theme, keybindings, { cwd: process.cwd(), notify: (message: string, level: string) => {
			if (level === "error") errors.push(message);
		} });
		editor.host.options.args = ["--clean", "--embed"];
		return editor;
	};
	const handlers = new Map<string, Function>();
	nvimPrompt({ on: (event: string, handler: Function) => handlers.set(event, handler), registerCommand() {} });
	handlers.get("session_start")!({}, { mode: "tui", ui: {
		getEditorComponent: () => factory, setEditorComponent: (value: any) => { factory = value; },
		notify: (message: string, level: string) => { if (level === "error") errors.push(message); },
	} });
	editor = factory(tui, theme, keybindings);
	editor.focused = true;
	editor.onSubmit = (text: string) => submitted.push(text);
	// Same callback/insertTextAtCursor path used by Pi after reading clipboard.
	if (!realClipboard) editor.onPasteImage = () => {
		clipboardPastes++;
		editor.insertTextAtCursor("/tmp/pi-clipboard-test.png");
	};
	render();
	for (let i = 0; i < 100 && !editor.host.isReady; i++) await sleep(10);
	assert(editor.host.isReady, errors.join("\n") || "Neovim did not start");
	await sleep(20);
	return {
		editor, errors, submitted,
		get clipboardPastes() { return clipboardPastes; },
		get lines() { return lines; },
		resize: (nextWidth: number) => { width = nextWidth; render(); },
		lua: (script: string) => editor.host.rpc.request("nvim_exec_lua", [script, []]),
		async settle() { await sleep(15); await editor.host.syncState(); await sleep(15); assert.deepEqual(errors, []); },
		async dispose() { disposed = true; await editor.dispose(); },
	};
}

test("live image clipboard pastes into real Neovim in insert and normal modes", { skip: !installed || process.env.PI_TEST_LIVE_CLIPBOARD !== "1", timeout: 10000 }, async (t) => {
	const f = await createEditor(40, true);
	try {
		assert.match(await f.lua("return vim.env.WAYLAND_DISPLAY or ''"), /^wayland-\d+$/);
		assert.equal(await f.lua("return vim.fn['provider#clipboard#Executable']()"), "wl-copy");
		if ((await readLinuxClipboard()).kind !== "image") {
			t.skip("The live clipboard currently contains text, not an image");
			return;
		}
		for (const mode of ["insert", "normal"]) {
			f.editor.setText("");
			await f.settle();
			if (mode === "normal") { f.editor.handleInput("\x1b"); await f.settle(); }
			assert.equal(f.editor.host.mode, mode);
			f.editor.handleInput("\x16");
			for (let i = 0; i < 100 && !f.editor.getText().includes("pi-clipboard-"); i++) await sleep(25);
			await f.settle();
			const path = f.editor.getText().trim();
			assert.match(path, /pi-clipboard-.*\.(png|jpg|gif|webp)$/);
			try { assert((await readFile(path)).length > 0); } finally { await unlink(path); }
		}
	} finally { await f.dispose(); }
});

test("real Neovim keeps exact-wrap content visible with gutters and indentation", { skip: !installed, timeout: 15000 }, async () => {
	for (const profile of ["clean", "gutters", "indent"]) {
		const f = await createEditor(profile === "indent" ? 40 : 20);
		try {
			if (profile !== "clean") await f.lua("vim.wo.number=true; vim.wo.relativenumber=true; vim.wo.signcolumn='yes'; vim.wo.breakindent=true");
			if (profile === "indent") f.editor.handleInput("    ");
			for (let i = 1; i <= 45; i++) {
				f.editor.handleInput("x");
				await f.settle();
				assert.equal(await f.lua("return vim.fn.winsaveview().skipcol"), 0, `${profile} length ${i}`);
				assert(f.lines.some((line) => line.includes("x")), `${profile}: text disappeared`);
				if (profile === "clean") assert.equal(f.editor.host.editorState.displayHeight, Math.floor(i / 20) + 1);
			}
			for (let i = 0; i < 25; i++) { f.editor.handleInput("\x7f"); await f.settle(); }
			assert.equal(await f.lua("return vim.fn.winsaveview().skipcol"), 0);
			f.editor.handleInput("\x1b");
			await f.settle();
			assert.equal(f.editor.host.mode, "normal");
			f.resize(12);
			await f.settle();
		} finally { await f.dispose(); }
	}
});

test("real Neovim handles Unicode, tabs, multiline prompts and height cap", { skip: !installed, timeout: 5000 }, async () => {
	const f = await createEditor(20);
	try {
		for (const text of ["界".repeat(10), "\t" + "x".repeat(12), "first line\n" + "x".repeat(20)]) {
			f.editor.setText(text);
			await f.settle();
			assert.equal(f.editor.getText(), text);
			assert.equal(await f.lua("return vim.fn.winsaveview().skipcol"), 0);
		}
		f.editor.setText("x".repeat(140));
		await f.settle();
		assert.equal(f.editor.host.editorState.displayHeight, 8);
		assert.equal(await f.lua("return vim.api.nvim_win_get_height(0)"), 7);
		f.editor.handleInput("\x1b");
		await f.settle();
		assert.equal(f.editor.host.editorState.displayHeight, 7);
	} finally { await f.dispose(); }
});

test("real parser preserves paste, splits keys, and routes image insertion", { skip: !installed, timeout: 5000 }, async () => {
	const f = await createEditor(40);
	try {
		f.editor.handleInput("\x1b[200~/mode glm\n\x16\x1b[201~");
		await f.settle();
		assert.equal(f.clipboardPastes, 0);
		assert.deepEqual(f.submitted, []);
		assert(f.editor.getText().startsWith("/mode glm\n"));
		f.editor.setText("");
		await f.settle();
		// Fragmented Kitty Ctrl+V must still reach Pi, not literal Neovim input.
		f.editor.handleInput("\x1b[118;");
		f.editor.handleInput("5u");
		await f.settle();
		assert.equal(f.clipboardPastes, 1);
		assert.equal(f.editor.getText(), "/tmp/pi-clipboard-test.png");
		f.editor.setText("/mode glm");
		await f.settle();
		f.editor.handleInput("\r");
		await f.settle();
		assert.deepEqual(f.submitted, ["/mode glm"]);
		f.editor.handleInput("hello\r");
		await f.settle();
		assert.equal(f.editor.getText(), "hello\n");
		assert.deepEqual(f.submitted, ["/mode glm"]);
	} finally { await f.dispose(); }
});
