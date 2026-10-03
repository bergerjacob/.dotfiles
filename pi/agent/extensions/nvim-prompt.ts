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
 *      Ctrl+Enter also submits, from insert/replace mode, where plain
 *      Enter makes a newline.
 *    - Up/Down navigate Pi prompt history in plain normal mode; elsewhere
 *      they move the cursor. Line motion stays on j/k.
 *
 * 2. Slash commands: "/" from plain normal mode keeps its normal Neovim
 *    meaning (search), except when the prompt is empty — then it appends a
 *    "/" and enters insert mode so typing a command ("/nvim status")
 *    behaves like Pi's default editor. While the package's autocomplete
 *    popup is open, all overrides step aside so Enter/arrows/Escape drive
 *    the popup (Enter on a slash command confirms and submits).
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

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { appendFileSync } from "node:fs";

const debug = process.env.PI_NVIM_PROMPT_DEBUG === "1";
const debugLog = (message: string): void => {
	if (debug) appendFileSync("/tmp/nvim-prompt-debug.log", `${message}\n`);
};

type EditorFactory = ReturnType<ExtensionUIContext["getEditorComponent"]>;
type Editor = NonNullable<ReturnType<NonNullable<EditorFactory>>>;

/** Internal surface of the package's NeovimEditor used for key overrides. */
interface NeovimEditorInternals {
	host?: {
		isPlainNormal: boolean;
		mode: string;
		sendKeys(keys: string): unknown;
	};
	autocomplete?: {
		active: boolean;
	};
	submit(): void;
	getText?(): string;
	navigateHistory(direction: "previous" | "next"): void;
}

/**
 * Pre-route keys the package would otherwise send to Pi actions.
 * Unmatched input falls through to the package's own routing untouched.
 */
function overrideHandleInput(editor: Editor, next: (data: string) => void, data: string): void {
	const internals = editor as unknown as NeovimEditorInternals;
	const host = internals.host;
	if (!host) {
		next(data);
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
		editor.onEscape?.();
		return;
	}

	const plainNormal = host.isPlainNormal === true;

	// Enter: submit from plain normal mode, plain Neovim Enter everywhere else.
	if (matchesKey(data, "enter")) {
		debugLog(`enter: plainNormal=${host.isPlainNormal} mode=${host.mode}`);
		if (plainNormal) internals.submit();
		else host.sendKeys("<CR>");
		return;
	}

	// Ctrl+Enter submits from insert (or replace) mode, where plain Enter
	// inserts a newline instead.
	if (matchesKey(data, "ctrl+enter") && (host.mode.startsWith("i") || host.mode.startsWith("R"))) {
		debugLog(`ctrl+enter -> submit (mode=${host.mode})`);
		internals.submit();
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

function wrapFactory(factory: NonNullable<EditorFactory>): NonNullable<EditorFactory> {
	const wrapped = ((tui: unknown, theme: unknown, keybindings: unknown) => {
		const editor = factory(tui as never, theme as never, keybindings as never);
		const next = editor.handleInput.bind(editor);
		editor.handleInput = (data: string) => overrideHandleInput(editor, next, data);
		return editor;
	}) as NonNullable<EditorFactory>;
	// Idempotence marker: recognize our own wrapper.
	(wrapped as { __nvimPrompt?: boolean }).__nvimPrompt = true;
	return wrapped;
}

export default function nvimPrompt(pi: ExtensionAPI): void {
	let savedFactory: EditorFactory = undefined;
	let nvimActive = true;

	// Wrap the factory registered by @bizmyth/pi-neovim-editor. Extension
	// load order is not guaranteed, so retry briefly until their factory
	// appears, and skip if it is already our wrapper.
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		let attempts = 0;
		const tryWrap = (): void => {
			const factory = ctx.ui.getEditorComponent();
			debugLog(`tryWrap attempt=${attempts} factory=${factory ? "found" : "missing"}`);
			if (!factory) {
				if (++attempts > 80) return;
				setTimeout(tryWrap, 25);
				return;
			}
			if ((factory as { __nvimPrompt?: boolean }).__nvimPrompt) return;
			ctx.ui.setEditorComponent(wrapFactory(factory));
			debugLog("wrapped");
		};
		tryWrap();
	});

	const restore = (ui: ExtensionUIContext): void => {
		if (!savedFactory) {
			ui.notify("No embedded Neovim editor factory saved", "error");
			return;
		}
		ui.setEditorComponent(savedFactory);
		nvimActive = true;
		ui.notify("Embedded Neovim editor enabled", "info");
	};

	const disable = (ui: ExtensionUIContext): void => {
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
