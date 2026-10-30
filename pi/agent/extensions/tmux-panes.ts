/**
 * tmux extension — gives the agent named panes for long-running processes.
 *
 * Local fork of @ogulcancelik/pi-tmux with a strict, self-healing layout:
 *   - Every tmux call is scoped to the pane Pi runs in ($TMUX_PANE, a globally
 *     unique id), so worker panes can never land in another session or window.
 *   - Pi keeps the full-height left half. Workers live in a right-hand column
 *     of equal-height tiles (1, 1/2, 1/3, ...), rebalanced after every run
 *     and stop.
 *
 * Actions:
 *   run   — create a named pane in the right column and run a command in it
 *   read  — capture output from a named pane
 *   send  — send keys to a named pane (C-c, Enter, q, etc.)
 *   stop  — kill a named pane
 *   list  — list all managed panes
 *
 * Panes are tagged with @pi_name tmux user options for discovery.
 * The tool is disabled when not running inside tmux, or when pi is running inside herdr.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

interface PaneInfo {
	name: string;
	paneId: string;
	alive: boolean;
	command: string;
	pid: string;
	left: number;
	top: number;
	height: number;
}

// Strip ANSI escapes, OSC sequences, and tmux/wezterm wrapping
function stripAnsi(text: string): string {
	return (
		text
			// OSC sequences (e.g. \x1b]...\x07 or \x1b]...\x1b\\)
			.replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "")
			// tmux passthrough (\x1bPtmux;...\x1b\\)
			.replace(/\x1bPtmux;.*?\x1b\\/g, "")
			// CSI sequences (\x1b[...letter)
			.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
			// Remaining bare escapes
			.replace(/\x1b[^[\]P]/g, "")
			// Carriage returns (terminal rewrite lines)
			.replace(/\r/g, "")
	);
}

const PANE_FORMAT =
	"#{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}\t#{pane_left}\t#{pane_top}\t#{pane_height}";

export default function (pi: ExtensionAPI) {
	const inTmux = !!process.env.TMUX;
	const inHerdr = !!process.env.HERDR_ENV;
	const myPaneId = process.env.TMUX_PANE || "";
	if (!inTmux || inHerdr || !myPaneId) {
		return;
	}

	// --- helpers ---

	async function tmux(args: string[]) {
		return pi.exec("tmux", args);
	}

	/**
	 * Resolve Pi's own pane fresh on every call. Pane ids are unique across the
	 * whole tmux server, so targeting by id cannot leak into another session or
	 * window, and the window id follows Pi if its pane is ever moved.
	 */
	async function locateSelf(): Promise<{ windowId: string; left: number; width: number; windowWidth: number; zoomed: boolean }> {
		const result = await tmux([
			"display-message",
			"-p",
			"-t",
			myPaneId,
			"#{pane_id}\t#{window_id}\t#{pane_left}\t#{pane_width}\t#{window_width}\t#{window_zoomed_flag}",
		]);
		const [paneId, windowId, left, width, windowWidth, zoomed] = result.stdout.trim().split("\t");
		if (result.code !== 0 || paneId !== myPaneId || !windowId) {
			throw new Error(`Could not locate pi's tmux pane ${myPaneId}.`);
		}
		return { windowId, left: Number(left), width: Number(width), windowWidth: Number(windowWidth), zoomed: zoomed === "1" };
	}

	/** Every pane in Pi's window except Pi itself, ordered top to bottom. */
	async function listWindowPanes(windowId: string): Promise<PaneInfo[]> {
		const result = await tmux(["list-panes", "-t", windowId, "-F", PANE_FORMAT]);
		if (result.code !== 0) return [];

		const panes: PaneInfo[] = [];
		for (const line of result.stdout.trim().split("\n")) {
			if (!line.trim()) continue;
			const [paneId, paneName, command, pid, dead, left, top, height] = line.split("\t");
			if (paneId === myPaneId) continue;
			panes.push({
				name: paneName?.trim() || "",
				paneId,
				alive: dead !== "1",
				command,
				pid,
				left: Number(left),
				top: Number(top),
				height: Number(height),
			});
		}
		return panes.sort((a, b) => a.top - b.top);
	}

	/** Workers sit strictly to the right of Pi's column. */
	function rightColumn(panes: PaneInfo[], self: { left: number; width: number }): PaneInfo[] {
		return panes.filter((p) => p.left > self.left + self.width - 1);
	}

	async function findPane(name: string): Promise<PaneInfo | null> {
		const self = await locateSelf();
		const panes = await listWindowPanes(self.windowId);
		return panes.find((p) => p.name === name) ?? null;
	}

	/** Pi owns the left half; the right column is split into equal-height tiles. */
	async function rebalance(): Promise<void> {
		const self = await locateSelf();
		if (self.zoomed) return;
		const column = rightColumn(await listWindowPanes(self.windowId), self);
		if (column.length === 0) return;

		await tmux(["resize-pane", "-t", myPaneId, "-x", String(Math.floor((self.windowWidth - 1) / 2))]);

		if (column.length < 2) return;
		const total = column.reduce((sum, p) => sum + p.height, 0) + (column.length - 1);
		const each = Math.floor((total - (column.length - 1)) / column.length);
		// Resize top-down; the last tile absorbs the remainder.
		for (const pane of column.slice(0, -1)) {
			await tmux(["resize-pane", "-t", pane.paneId, "-y", String(each)]);
		}
	}

	async function capturePane(paneId: string, lines: number): Promise<string> {
		const result = await tmux(["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`]);
		if (result.code !== 0) throw new Error(`capture-pane failed: ${result.stderr}`);

		let output = stripAnsi(result.stdout);
		// Trim trailing blank lines (tmux pads to pane height)
		output = output.replace(/\n+$/, "\n");
		return output;
	}

	// --- tool ---

	pi.registerTool({
		name: "tmux",
		label: "tmux",
		description:
			"Manage tmux panes for long-running processes (dev servers, watchers, etc). " +
			"Actions: run (start command in named pane), read (capture output), send (send keys like C-c), stop (kill pane), list (show panes).",
		promptGuidelines: [
			"Use `tmux` run for long-running processes (dev servers, watchers, builds) instead of `bash`.",
			"Use `bash` only for short-lived commands that complete quickly.",
			"Layout is fixed: pi keeps the full-height left half of its own window. Worker panes are always created in pi's own tmux session and window, stacked in equal-height tiles on the right half.",
		],
		parameters: Type.Object({
			action: StringEnum(["run", "read", "send", "stop", "list"] as const, {
				description: "Action to perform",
			}),
			pane: Type.Optional(Type.String({ description: "Pane name (required for run/read/send/stop)" })),
			command: Type.Optional(Type.String({ description: "Shell command to run (for run action)" })),
			keys: Type.Optional(
				Type.String({
					description: "Keys to send, space-separated (for send action). Examples: C-c, Enter, q, y",
				}),
			),
			text: Type.Optional(
				Type.String({
					description: "Literal text to type into the pane (for send action). Sent as-is, no key lookup.",
				}),
			),
			lines: Type.Optional(
				Type.Number({ description: "Scrollback lines to capture (for read action, default: 20)" }),
			),
			restart: Type.Optional(
				Type.Boolean({ description: "Kill existing pane before starting (for run action, default: false)" }),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory (for run action)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { action } = params;

			switch (action) {
				case "run": {
					const { pane, command, restart, cwd } = params;
					if (!pane) throw new Error("'pane' is required for run");
					if (!command) throw new Error("'command' is required for run");

					const existing = await findPane(pane);

					// Dead pane → always replace. Alive pane → error unless restart.
					if (existing?.alive && !restart) {
						throw new Error(
							`Pane '${pane}' already exists (running ${existing.command}). Use restart: true to replace it.`,
						);
					}
					if (existing) {
						await tmux(["kill-pane", "-t", existing.paneId]);
					}

					// Splitting a zoomed window would otherwise reshuffle the layout.
					let self = await locateSelf();
					if (self.zoomed) {
						await tmux(["resize-pane", "-Z", "-t", myPaneId]);
						self = await locateSelf();
					}

					// First worker: a full-height split to the right of everything, so
					// pi's column stays intact. Later workers: split the bottom tile.
					const column = rightColumn(await listWindowPanes(self.windowId), self);
					const splitArgs = ["split-window", "-d", "-P", "-F", "#{pane_id}"];
					if (column.length === 0) {
						splitArgs.push("-f", "-h", "-l", "50%", "-t", myPaneId);
					} else {
						splitArgs.push("-v", "-t", column[column.length - 1].paneId);
					}
					if (cwd) splitArgs.push("-c", cwd);

					const result = await tmux(splitArgs);
					if (result.code !== 0) throw new Error(`split-window failed: ${result.stderr}`);

					const newPaneId = result.stdout.trim();

					// Tag with name
					await tmux(["set-option", "-p", "-t", newPaneId, "@pi_name", pane]);
					await rebalance();

					// Send command (literal text + Enter)
					await tmux(["send-keys", "-l", "-t", newPaneId, command]);
					await tmux(["send-keys", "-t", newPaneId, "Enter"]);

					// Wait briefly and capture initial output
					await new Promise((r) => setTimeout(r, 1500));
					const initialOutput = await capturePane(newPaneId, 20);

					return {
						content: [
							{
								type: "text",
								text: `Started '${command}' in pane '${pane}' (${newPaneId})\n\n${initialOutput}`,
							},
						],
						details: { action: "run", pane, paneId: newPaneId, command },
					};
				}

				case "read": {
					const { pane, lines } = params;
					if (!pane) throw new Error("'pane' is required for read");

					const existing = await findPane(pane);
					if (!existing) throw new Error(`Pane '${pane}' not found. Use action 'list' to see managed panes.`);

					const output = await capturePane(existing.paneId, lines ?? 20);

					const truncation = truncateTail(output, {
						maxLines: DEFAULT_MAX_LINES,
						maxBytes: DEFAULT_MAX_BYTES,
					});

					let text = truncation.content;
					if (truncation.truncated) {
						text = `[Showing last ${truncation.outputLines} of ${truncation.totalLines} lines]\n${text}`;
					}

					return {
						content: [{ type: "text", text }],
						details: { action: "read", pane, alive: existing.alive, command: existing.command },
					};
				}

				case "send": {
					const { pane, keys, text } = params;
					if (!pane) throw new Error("'pane' is required for send");
					if (!keys && !text) throw new Error("'keys' or 'text' is required for send");

					const existing = await findPane(pane);
					if (!existing) throw new Error(`Pane '${pane}' not found.`);

					// Send literal text first (if provided)
					if (text) {
						await tmux(["send-keys", "-l", "-t", existing.paneId, text]);
					}

					// Then send special keys (if provided)
					if (keys) {
						const keyArgs = keys.split(/\s+/).filter(Boolean);
						await tmux(["send-keys", "-t", existing.paneId, ...keyArgs]);
					}

					const desc = [text && `"${text}"`, keys].filter(Boolean).join(" + ");
					return {
						content: [{ type: "text", text: `Sent ${desc} to pane '${pane}'` }],
						details: { action: "send", pane, keys, text },
					};
				}

				case "stop": {
					const { pane } = params;
					if (!pane) throw new Error("'pane' is required for stop");

					const existing = await findPane(pane);
					if (!existing) throw new Error(`Pane '${pane}' not found.`);

					await tmux(["kill-pane", "-t", existing.paneId]);
					await rebalance();

					return {
						content: [{ type: "text", text: `Stopped pane '${pane}'` }],
						details: { action: "stop", pane },
					};
				}

				case "list": {
					const self = await locateSelf();
					const panes = await listWindowPanes(self.windowId);

					if (panes.length === 0) {
						return {
							content: [{ type: "text", text: "No panes (besides pi)." }],
							details: { action: "list", panes: [] },
						};
					}

					const text = panes
						.map((p) => {
							const label = p.name || `[${p.command}]`;
							const managed = p.name ? "" : " (unmanaged)";
							return `${label}: ${p.alive ? "running" : "dead"} (${p.command}) [${p.paneId}]${managed}`;
						})
						.join("\n");

					return {
						content: [{ type: "text", text }],
						details: { action: "list", panes },
					};
				}

				default:
					throw new Error(`Unknown action: ${action}`);
			}
		},

		// --- rendering ---

		renderCall(args, theme) {
			const action = args.action || "?";
			let text = theme.fg("toolTitle", theme.bold("tmux "));
			text += theme.fg("accent", action);

			if (args.pane) text += theme.fg("muted", ` ${args.pane}`);
			if (args.command) text += theme.fg("dim", ` › ${args.command}`);
			if (args.text) text += theme.fg("dim", ` › "${args.text}"`);
			if (args.keys) text += theme.fg("dim", ` › ${args.keys}`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as Record<string, any> | undefined;
			if (!details) {
				const c = result.content?.[0];
				return new Text(c?.type === "text" ? c.text : "", 0, 0);
			}

			switch (details.action) {
				case "run": {
					let t = theme.fg("success", `▶ ${details.pane}`);
					t += theme.fg("dim", ` › ${details.command}`);
					return new Text(t, 0, 0);
				}

				case "read": {
					const dot = details.alive ? theme.fg("success", "●") : theme.fg("error", "●");
					let t = `${dot} ${theme.fg("accent", details.pane)}`;

					if (expanded) {
						const c = result.content?.[0];
						if (c?.type === "text") {
							const outputLines = c.text.split("\n").slice(0, 40);
							t += "\n" + outputLines.map((l: string) => theme.fg("dim", l)).join("\n");
							const total = c.text.split("\n").length;
							if (total > 40) {
								t += `\n${theme.fg("muted", `... (${total} total lines)`)}`;
							}
						}
					}
					return new Text(t, 0, 0);
				}

				case "send": {
					const desc = [details.text && `"${details.text}"`, details.keys].filter(Boolean).join(" + ");
					return new Text(theme.fg("accent", `⏎ ${details.pane} › ${desc}`), 0, 0);
				}

				case "stop": {
					return new Text(theme.fg("warning", `■ ${details.pane}`), 0, 0);
				}

				case "list": {
					const panes = details.panes as PaneInfo[];
					if (!panes?.length) return new Text(theme.fg("dim", "no panes"), 0, 0);

					const lines = panes.map((p) => {
						const dot = p.alive ? theme.fg("success", "●") : theme.fg("error", "●");
						const label = p.name
							? theme.fg("accent", p.name)
							: theme.fg("muted", `[${p.command}]`);
						const extra = p.name ? "" : theme.fg("dim", " (unmanaged)");
						return `${dot} ${label} ${theme.fg("dim", p.command)}${extra}`;
					});
					return new Text(lines.join("\n"), 0, 0);
				}

				default: {
					const c = result.content?.[0];
					return new Text(c?.type === "text" ? c.text : "", 0, 0);
				}
			}
		},
	});
}
