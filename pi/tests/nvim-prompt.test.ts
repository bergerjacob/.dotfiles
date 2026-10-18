// Run: node --test pi/tests/nvim-prompt.test.ts (uses the installed Pi runtime)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const globalModules = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const requirePi = createRequire(join(globalModules, "@earendil-works/pi-coding-agent/package.json"));
const { createJiti } = requirePi("jiti");
const tuiPath = requirePi.resolve("@earendil-works/pi-tui");
const tui = await import(pathToFileURL(tuiPath).href);
const { matchesKey } = tui;
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-tui": tuiPath }, moduleCache: false });
const { default: nvimPrompt } = await jiti.import("../agent/extensions/nvim-prompt.ts");

function wrapEditor(editor: any, keybindings: any) {
	const handlers = new Map<string, Function>();
	let factory: any = () => editor;
	const ui = {
		getEditorComponent: () => factory,
		setEditorComponent: (next: any) => { factory = next; },
		notify: () => {},
	};
	nvimPrompt({ on: (event: string, handler: Function) => handlers.set(event, handler), registerCommand: () => {} } as any);
	handlers.get("session_start")!({}, { mode: "tui", ui });
	return factory({}, {}, keybindings);
}

const pasteKey = "ctrl+v";
function fixture(options: { mode?: string; text?: string; active?: boolean; prompt?: boolean; clipboardKey?: string } = {}) {
	const sent: string[] = [];
	const passed: string[] = [];
	let submitted = 0;
	let pasted = 0;
	let interrupted = 0;
	const editor = {
		host: {
			mode: options.mode ?? "insert",
			isPlainNormal: options.mode === "normal",
			editorState: { promptBufferActive: options.prompt ?? true },
			sendKeys: (data: string) => sent.push(data),
		},
		autocomplete: { active: options.active ?? false },
		getText: () => options.text ?? "hello",
		submit: () => submitted++,
		navigateHistory: (direction: string) => sent.push(direction),
		onPasteImage: () => pasted++,
		onEscape: () => interrupted++,
		render: (_width: number) => [],
		routeKeys: (data: string) => passed.push(data),
	};
	wrapEditor(editor, { matches: (data: string, action: string) => action === "app.clipboard.pasteImage" && matchesKey(data, options.clipboardKey ?? pasteKey) });
	return { editor, sent, passed, counts: () => ({ submitted, pasted, interrupted }) };
}

describe("parsed Neovim key routing", () => {
	for (const mode of ["normal", "insert", "replace", "visual", "cmdline_normal"]) {
		test(`clipboard stays with Pi in ${mode}, even with autocomplete`, () => {
			const f = fixture({ mode, active: true });
			f.editor.routeKeys("\x16");
			assert.equal(f.counts().pasted, 1);
			assert.deepEqual(f.sent, []);
			assert.deepEqual(f.passed, []);
		});
	}
	test("Ctrl+Shift+V routes to image paste when terminal forwards it", () => {
		const f = fixture({ mode: "normal" });
		f.editor.routeKeys("\x1b[118;6u");
		assert.equal(f.counts().pasted, 1);
	});
	test("respects remapped clipboard key", () => {
		const f = fixture({ clipboardKey: "alt+v" });
		f.editor.routeKeys("\x1bv");
		f.editor.routeKeys("\x16");
		assert.equal(f.counts().pasted, 1);
		assert.deepEqual(f.passed, ["\x16"]);
	});
	for (const active of [false, true]) {
		test(`/mode glm submits verbatim with autocomplete=${active}`, () => {
			const f = fixture({ text: "/mode glm", active });
			f.editor.routeKeys("\r");
			assert.equal(f.counts().submitted, 1);
			assert.deepEqual(f.sent, []);
			assert.deepEqual(f.passed, []);
		});
	}
	test("bare command submits without popup", () => {
		const f = fixture({ text: "/nvim" });
		f.editor.routeKeys("\r");
		assert.equal(f.counts().submitted, 1);
	});
	test("command-name completion still owns Enter", () => {
		const f = fixture({ text: "/mo", active: true });
		f.editor.routeKeys("\r");
		assert.equal(f.counts().submitted, 0);
		assert.deepEqual(f.passed, ["\r"]);
	});
	for (const text of ["hello", "/mode glm\nmore text", " /some/path", "//comment"]) {
		test(`ordinary/multiline text keeps insert-mode newlines: ${JSON.stringify(text)}`, () => {
			const f = fixture({ text });
			f.editor.routeKeys("\r");
			assert.equal(f.counts().submitted, 0);
			assert.deepEqual(f.sent, ["<CR>"]);
		});
	}
	test("other Neovim buffers do not submit slash text", () => {
		const f = fixture({ text: "/mode glm", prompt: false });
		f.editor.routeKeys("\r");
		assert.equal(f.counts().submitted, 0);
		assert.deepEqual(f.sent, ["<CR>"]);
	});
	for (const mode of ["insert", "replace", "normal"]) {
		test(`Ctrl+Enter explicitly submits in ${mode}, even with popup`, () => {
			const f = fixture({ mode, active: true });
			f.editor.routeKeys("\x1b[13;5u");
			assert.equal(f.counts().submitted, 1);
		});
	}
	test("normal Enter submits, cmdline Enter executes Neovim", () => {
		const normal = fixture({ mode: "normal" });
		normal.editor.routeKeys("\r");
		assert.equal(normal.counts().submitted, 1);
		const cmdline = fixture({ mode: "cmdline_normal", text: "/mode glm" });
		cmdline.editor.routeKeys("\r");
		assert.deepEqual(cmdline.sent, ["<CR>"]);
	});
	test("Escape goes to Neovim and Ctrl+C interrupts outside popup", () => {
		const f = fixture();
		f.editor.routeKeys("\x1b");
		f.editor.routeKeys("\x03");
		assert.deepEqual(f.sent, ["<Esc>"]);
		assert.equal(f.counts().interrupted, 1);
	});
});
