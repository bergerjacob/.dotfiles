/**
 * nvim-prompt — key-routing companion for @bizmyth/pi-neovim-editor,
 *
 * 1. Key routing overrides on top of the package's default routing:
 *    - Escape ALWAYS goes to Neovim (leave insert, close cmdline, run your
 *      own Escape mappings such as :nohl). It never interrupts the running
 *      model; spamming Escape is safe.
 *    - Ctrl+C interrupts/stops the model.
 *    - Enter submits the prompt only from plain normal mode (no pending
 *      operator or count). In any other mode it is a normal Neovim Enter
 *      (newline in insert, executes the command line in cmdline mode).
 *      Ctrl+Enter also submits from normal/insert/replace mode, where plain
 *      Enter makes a newline. Single-line slash commands also submit from
 *      insert/replace mode, including commands with arguments.
 *    - Clipboard paste stays with Pi in every mode (Ctrl+V by default),
 *      including when autocomplete is open; text fallback is preserved.
 *    - Up/Down navigate Pi prompt history in plain normal mode; elsewhere
 *      they move the cursor. Line motion stays on j/k.
 *
 * 2. Slash commands: "/" from plain normal mode keeps its normal Neovim
 *    meaning (search), except when the prompt is empty — then it appends a
 *    "/" and enters insert mode so typing a command ("/nvim status")
 *    behaves like Pi's default editor. Command-name autocomplete keeps
 *    Enter/arrows/Escape; commands with arguments submit their typed text.
 *    Tab accepts argument suggestions; Ctrl+Enter explicitly submits.
 *
 * 3. Session toggle:
 *    - /nvim          toggle
 *    - /nvim off      switch to the default Pi editor (draft text is kept)
 *    - /nvim on       switch back to the embedded Neovim editor
 *    - /nvim status   show which editor is active
 *
 * The nvim editor package owns the Neovim process lifecycle. Disabling here
 * swaps the editor component; its Neovim child stays alive until session
 * shutdown or /reload (the package disposes every editor it created).
 */

import type { ExtensionAPI, ExtensionUIContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { appendFileSync } from "node:fs";
import { neovimClipboardStartup, readLinuxClipboard, saveClipboardImage } from "./nvim-prompt/clipboard";

const debug = process.env.PI_NVIM_PROMPT_DEBUG === "1";
const debugLog = (message: string): void => {
	if (debug) appendFileSync("/tmp/nvim-prompt-debug.log", `${message}\n`);
};

type EditorFactory = ReturnType<ExtensionUIContext["getEditorComponent"]>;
type Editor = NonNullable<ReturnType<NonNullable<EditorFactory>>>;

/** Internal surface of the package's NeovimEditor used for key overrides. */
interface NeovimEditorInternals {
	disposed?: boolean;
	onPasteImage?: () => void;
	onEscape?: () => void;
	host?: {
		isPlainNormal: boolean;
		mode: string;
		editorState?: { promptBufferActive: boolean };
		rpc?: { request(method: string, args?: unknown[]): Promise<unknown> };
		options?: { args?: string[] };
		start?(width: number, height: number): Promise<void>;
		sendKeys(keys: string): unknown;
	};
	autocomplete?: {
		active: boolean;
	};
	createHost?(initialText: string): NonNullable<NeovimEditorInternals["host"]>;
	routeKeys(data: string): void;
	submit(): void;
	getText?(): string;
	navigateHistory(direction: "previous" | "next"): void;
}

function isEditingMode(mode: string): boolean {
	// The package reports mode families; raw modes are accepted for compatibility.
	return mode === "insert" || mode === "replace" || /^(i|R)/.test(mode);
}

/**
 * Pre-route keys the package would otherwise send to Pi actions.
 * Unmatched input falls through to the package's own routing untouched.
 */
function overrideKeys(editor: Editor, keybindings: KeybindingsManager, next: (data: string) => void, data: string): void {
	const internals = editor as unknown as NeovimEditorInternals;
	const host = internals.host;
	if (!host) {
		next(data);
		return;
	}

	// Paste belongs to Pi, not Neovim's Ctrl+V (blockwise visual/literal input).
	// Respect remapping and keep Pi's native image handling and text fallback.
	if ((keybindings.matches(data, "app.clipboard.pasteImage") || matchesKey(data, "ctrl+shift+v")) && internals.onPasteImage) {
		debugLog("clipboard -> pi");
		internals.onPasteImage();
		return;
	}

	const editing = isEditingMode(host.mode);
	const text = internals.getText?.() ?? "";
	const slashCommand = host.editorState?.promptBufferActive !== false && /^\/[^\s/]+(?:[ \t][^\r\n]*)?$/.test(text);
	// Once arguments are present, Enter sends exactly what was typed. Tab is
	// still available to accept an argument suggestion before submission.
	if (editing && slashCommand && /[ \t]/.test(text) && matchesKey(data, "enter")) {
		debugLog("enter -> slash command with arguments");
		internals.submit();
		return;
	}

	// Ctrl+Enter is an explicit submission, not an autocomplete selection.
	if (matchesKey(data, "ctrl+enter") && (editing || host.isPlainNormal)) {
		debugLog(`ctrl+enter -> submit (mode=${host.mode})`);
		internals.submit();
		return;
	}

	// While the package's autocomplete popup is open, it owns the keys:
	// Enter/arrows confirm and navigate, Escape cancels. Our mode-based
	// overrides would swallow those, so pass everything through untouched.
	if (internals.autocomplete?.active === true) {
		debugLog("autocomplete active -> passthrough");
		next(data);
		return;
	}

	// Escape belongs to Neovim in every mode, even when the agent is running.
	if (matchesKey(data, "escape")) {
		debugLog(`escape -> nvim (mode=${host.mode})`);
		host.sendKeys("<Esc>");
		return;
	}

	// Ctrl+C is the dedicated "stop the model" key.
	if (matchesKey(data, "ctrl+c")) {
		debugLog("ctrl+c -> interrupt");
		internals.onEscape?.();
		return;
	}

	const plainNormal = host.isPlainNormal === true;

	// Enter submits from normal mode or a single-line prompt slash command.
	// All other modes/text retain Neovim's native Enter behavior.
	if (matchesKey(data, "enter")) {
		debugLog(`enter: plainNormal=${host.isPlainNormal} mode=${host.mode}`);
		if (plainNormal || (editing && slashCommand)) internals.submit();
		else host.sendKeys("<CR>");
		return;
	}

	// Arrow history navigation, like Pi's default editor, but only from
	// plain normal mode. In insert mode the arrows move the cursor.
	// Slash from plain normal mode: keep Neovim search, except when the
	// prompt is empty — then append "/" at the end and enter insert mode.
	// The package's autocomplete notices the "/" prefix and opens the
	// command list, like Pi's default editor.
	if (plainNormal && matchesKey(data, "/") && (internals.getText?.().length ?? 0) === 0) {
		debugLog("slash -> start prompt command (empty prompt)");
		host.sendKeys("A/");
		return;
	}

	if (plainNormal && matchesKey(data, "up")) {
		debugLog("up -> history previous");
		internals.navigateHistory("previous");
		return;
	}
	if (plainNormal && matchesKey(data, "down")) {
		debugLog("down -> history next");
		internals.navigateHistory("next");
		return;
	}

	next(data);
}

// nvim_win_text_height excludes the insert cursor's cell beyond EOL. Count
// its logical screen row as well, including rows above a scrolled viewport.
// This keeps exact-width lines visible without a permanent spare/filler row.
const heightMeasurement = "local display_height = vim.api.nvim_win_text_height(0, {}).all";
const cursorHeightMeasurement = `${heightMeasurement}
if active and (raw_mode:sub(1, 1) == 'i' or raw_mode:sub(1, 1) == 'R') then
  local view = vim.fn.winsaveview()
  local cursor_height = vim.fn.winline()
  if view.topline > 1 then
    cursor_height = cursor_height + vim.api.nvim_win_text_height(0, { start_row = 0, end_row = view.topline - 2 }).all
  end
  if view.skipcol > 0 then
    cursor_height = cursor_height + vim.api.nvim_win_text_height(0, { start_row = view.topline - 1, end_row = view.topline - 1, end_vcol = view.skipcol }).all
  end
  display_height = math.max(display_height, cursor_height)
end`;

function wrapFactory(factory: NonNullable<EditorFactory>, ui: ExtensionUIContext): NonNullable<EditorFactory> {
	const wrapped: NonNullable<EditorFactory> = (tui, theme, keybindings) => {
		const editor = factory(tui, theme, keybindings);
		const internals = editor as unknown as NeovimEditorInternals;
		// Hook AFTER the package's terminal parser. Raw handleInput chunks can
		// contain several keys or split CSI sequences; bracketed paste must never
		// be mistaken for a shortcut or a slash-command submission.
		if (internals.host && typeof internals.routeKeys === "function") {
			const prepareHost = (host: NonNullable<NeovimEditorInternals["host"]>): void => {
				if (process.platform !== "linux" || !host.start || !host.options) return;
				const start = host.start.bind(host);
				host.start = (width, height) => {
					const args = host.options!.args ?? ["--embed"];
					if (!args.includes(`lua ${neovimClipboardStartup}`)) {
						host.options!.args = [...args, "--cmd", `lua ${neovimClipboardStartup}`];
					}
					return start(width, height);
				};
			};
			prepareHost(internals.host);
			// Crash recovery creates a new host and starts it before render.
			if (internals.createHost) {
				const createHost = internals.createHost.bind(editor);
				internals.createHost = (text) => {
					const host = createHost(text);
					prepareHost(host);
					return host;
				};
			}
			if (process.platform === "linux" && !internals.onPasteImage) {
				let pasting = false;
				internals.onPasteImage = () => {
					if (pasting) return;
					pasting = true;
					void (async () => {
						try {
							const value = await readLinuxClipboard();
							if (internals.disposed) return;
							if (!editor.insertTextAtCursor) throw new Error("This editor cannot insert clipboard content.");
							const text = value.kind === "image" ? ` ${await saveClipboardImage(value)} ` : value.text;
							if (internals.disposed) return;
							editor.insertTextAtCursor(text);
							if (value.kind === "image") ui.notify("Image pasted into the prompt", "info");
							tui.requestRender();
						} catch (error) {
							if (!internals.disposed) ui.notify(`Clipboard paste failed: ${error instanceof Error ? error.message : String(error)}`, "error");
						} finally { pasting = false; }
					})();
				};
			}
			const next = internals.routeKeys.bind(editor);
			internals.routeKeys = (data) => overrideKeys(editor, keybindings, next, data);
			const patchedRpcs = new WeakSet<object>();
			const patchHeight = (): void => {
				const rpc = internals.host?.rpc;
				if (!rpc || patchedRpcs.has(rpc)) return;
				patchedRpcs.add(rpc);
				const request = rpc.request.bind(rpc);
				rpc.request = (method, args = []) => {
					const script = args[0];
					// Compatibility shim for the package's GET_STATE_LUA only.
					// Leave all other RPCs and unrecognized future versions alone.
					if (
						method === "nvim_exec_lua" && typeof script === "string" &&
						script.startsWith("local buffer = vim.g.pi_prompt_buffer") &&
						script.includes("local raw_mode = mode_info.mode") && script.includes(heightMeasurement)
					) {
						args = [script.replace(heightMeasurement, cursorHeightMeasurement), ...args.slice(1)];
					}
					return request(method, args);
				};
			};
			const render = editor.render.bind(editor);
			editor.render = (width) => {
				patchHeight();
				const lines = render(width);
				// First render starts the RPC client synchronously. Also pick up a
				// replacement host after the package's automatic crash recovery.
				patchHeight();
				// Resize is asynchronous: the old grid may briefly be wider than
				// the new terminal. Never render beyond Pi's right edge.
				return lines.map((line) => truncateToWidth(line, Math.max(1, width), ""));
			};
		}
		return editor;
	};
	// Idempotence marker: recognize our own wrapper.
	(wrapped as { __nvimPrompt?: boolean }).__nvimPrompt = true;
	return wrapped;
}

export default function nvimPrompt(pi: ExtensionAPI): void {
	let savedFactory: EditorFactory = undefined;
	let nvimActive = true;
	let wrapTimer: ReturnType<typeof setTimeout> | undefined;

	pi.on("session_shutdown", () => {
		if (wrapTimer) clearTimeout(wrapTimer);
		wrapTimer = undefined;
	});

	// Wrap the factory registered by @bizmyth/pi-neovim-editor. Extension
	// load order is not guaranteed, so retry briefly until their factory
	// appears, and skip if it is already our wrapper.
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (wrapTimer) clearTimeout(wrapTimer);
		let attempts = 0;
		const tryWrap = (): void => {
			wrapTimer = undefined;
			const factory = ctx.ui.getEditorComponent();
			debugLog(`tryWrap attempt=${attempts} factory=${factory ? "found" : "missing"}`);
			if (!factory) {
				if (++attempts > 80) return;
				wrapTimer = setTimeout(tryWrap, 25);
				return;
			}
			if ((factory as { __nvimPrompt?: boolean }).__nvimPrompt) return;
			ctx.ui.setEditorComponent(wrapFactory(factory, ctx.ui));
			debugLog("wrapped");
		};
		tryWrap();
	});

	const restore = (ui: ExtensionUIContext): void => {
		if (nvimActive) return;
		if (!savedFactory) {
			ui.notify("No embedded Neovim editor factory saved", "error");
			return;
		}
		ui.setEditorComponent(savedFactory);
		nvimActive = true;
		ui.notify("Embedded Neovim editor enabled", "info");
	};

	const disable = (ui: ExtensionUIContext): void => {
		if (!nvimActive) return;
		const factory = ui.getEditorComponent();
		if (!factory) {
			ui.notify("Embedded Neovim editor is not active", "error");
			return;
		}
		savedFactory = factory;
		ui.setEditorComponent(undefined);
		nvimActive = false;
		ui.notify("Embedded Neovim editor disabled (default editor active)", "info");
	};

	pi.registerCommand("nvim", {
		description: "Toggle embedded Neovim editor (on|off|status)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			switch (arg) {
				case "on":
					restore(ctx.ui);
					return;
				case "off":
					disable(ctx.ui);
					return;
				case "status":
					ctx.ui.notify(
						nvimActive ? "Embedded Neovim editor is active" : "Embedded Neovim editor is disabled",
						"info",
					);
					return;
				case "":
					if (nvimActive) disable(ctx.ui);
					else restore(ctx.ui);
					return;
				default:
					ctx.ui.notify("Usage: /nvim [on|off|status]", "error");
			}
		},
	});
}
