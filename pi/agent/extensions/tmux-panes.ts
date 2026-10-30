/** Named processes beside Pi: owned panes, exact commands, retained exit status. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";

interface PaneInfo {
	name: string;
	paneId: string;
	owner: string;
	alive: boolean;
	command: string;
	pid: string;
	left: number;
	top: number;
	height: number;
	exitCode: string;
	exitSignal: string;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "")
		.replace(/\x1bPtmux;.*?\x1b\\/g, "")
		.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\x1b[^[\]P]/g, "").replace(/\r/g, "");
}

function quote(text: string): string {
	return "'" + text.replace(/'/g, "'\\''") + "'";
}

function status(pane: PaneInfo): string {
	return pane.alive ? `running (${pane.command})` : pane.exitSignal
		? `exited (signal ${pane.exitSignal})` : `exited (code ${pane.exitCode || "unknown"})`;
}

const PANE_FORMAT = "#{pane_id}\t#{@pi_name}\t#{@pi_owner}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}\t#{pane_left}\t#{pane_top}\t#{pane_height}\t#{pane_dead_status}\t#{pane_dead_signal}";

export default function (pi: ExtensionAPI) {
	const myPaneId = process.env.TMUX_PANE || "";
	if (!process.env.TMUX || process.env.HERDR_ENV || !myPaneId) return;

	async function tmux(args: string[]) {
		return pi.exec("tmux", args, { timeout: 5000 });
	}
	async function checked(args: string[]) {
		const result = await tmux(args);
		if (result.code !== 0) throw new Error(`tmux ${args[0]} failed: ${result.stderr.trim()}`);
		return result;
	}
	async function locateSelf() {
		const result = await checked(["display-message", "-p", "-t", myPaneId,
			"#{pane_id}\t#{window_id}\t#{pane_left}\t#{pane_width}\t#{window_width}\t#{window_zoomed_flag}"]);
		const [paneId, windowId, left, width, windowWidth, zoomed] = result.stdout.trim().split("\t");
		if (paneId !== myPaneId || !windowId) throw new Error(`Could not locate Pi's tmux pane ${myPaneId}.`);
		return { windowId, left: Number(left), width: Number(width), windowWidth: Number(windowWidth), zoomed: zoomed === "1" };
	}
	async function listWindowPanes(windowId: string): Promise<PaneInfo[]> {
		const result = await checked(["list-panes", "-t", windowId, "-F", PANE_FORMAT]);
		return result.stdout.split("\n").filter(Boolean).map((line) => {
			const [paneId, name, owner, command, pid, dead, left, top, height, exitCode, exitSignal] = line.split("\t");
			return { paneId, name, owner, command, pid, alive: dead !== "1", left: Number(left),
				top: Number(top), height: Number(height), exitCode, exitSignal };
		}).filter((p) => p.paneId !== myPaneId).sort((a, b) => a.top - b.top);
	}
	const owned = (p: PaneInfo) => p.owner === myPaneId && Boolean(p.name);
	async function findPane(name: string) {
		const self = await locateSelf();
		return (await listWindowPanes(self.windowId)).find((p) => owned(p) && p.name === name);
	}
	async function rebalance() {
		const self = await locateSelf();
		if (self.zoomed) return;
		const panes = await listWindowPanes(self.windowId);
		// Never resize an unrelated pane, even if it happens to sit on the right.
		if (panes.some((p) => !owned(p))) return;
		const column = panes.filter((p) => p.left > self.left);
		if (!column.length) return;
		await checked(["resize-pane", "-t", myPaneId, "-x", String(Math.floor((self.windowWidth - 1) / 2))]);
		if (column.length < 2) return;
		const each = Math.floor(column.reduce((sum, p) => sum + p.height, 0) / column.length);
		for (const pane of column.slice(0, -1)) await checked(["resize-pane", "-t", pane.paneId, "-y", String(each)]);
	}
	async function capturePane(paneId: string, lines: number) {
		const result = await checked(["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`]);
		return stripAnsi(result.stdout).replace(/\n+$/, "\n");
	}

	// Pi can execute sibling calls concurrently. Serialize pane mutations so two
	// launches cannot both pass the same name check or split an obsolete tile.
	let queue: Promise<unknown> = Promise.resolve();
	async function serialize<T>(fn: () => Promise<T>): Promise<T> {
		const next = queue.then(fn, fn);
		queue = next.catch(() => {});
		return next;
	}

	pi.registerTool({
		name: "tmux", label: "tmux",
		description: "Manage named process panes beside Pi. Actions: run, read (output and exit status), send, stop, list. Commands run exactly as supplied in non-interactive bash, including multiline scripts; completed panes remain readable and are replaced on the next run of that name.",
		promptGuidelines: [
			"Use `tmux` run for long-running processes instead of `bash`; use `bash` for short commands.",
			"Pi keeps the full-height left half of its own window; owned workers tile on the right. Never create other sessions/windows or manipulate unrelated panes to bypass capacity errors.",
			"Read/list report process exit status. Stop completed panes when no longer needed. Use restart:true only when intentionally replacing a running process.",
		],
		parameters: Type.Object({
			action: StringEnum(["run", "read", "send", "stop", "list"] as const),
			pane: Type.Optional(Type.String({ description: "Name required for run/read/send/stop" })),
			command: Type.Optional(Type.String({ description: "Exact bash command/script for run; multiline supported" })),
			keys: Type.Optional(Type.String({ description: "Special keys for send, e.g. C-c or Enter" })),
			text: Type.Optional(Type.String({ description: "Literal input for send (not an executed shell script)" })),
			lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000, description: "Scrollback lines, default 20" })),
			restart: Type.Optional(Type.Boolean({ description: "Replace a running owned pane; exited panes are replaced automatically" })),
			cwd: Type.Optional(Type.String({ description: "Working directory; defaults to current project" })),
		}),
		async execute(_id, params, signal, _update, ctx) {
			return serialize(async () => {
				if (signal?.aborted) throw new Error("tmux action cancelled");
				const { action, pane } = params;
				if (action !== "list" && (!pane || !/^[\w.-]{1,80}$/.test(pane))) {
					throw new Error("A pane name of 1–80 letters, digits, underscores, dots or hyphens is required.");
				}
				if (action === "run") {
					const { command, restart, cwd } = params;
					if (!command || command.includes("\0")) throw new Error("A nonempty command without NUL bytes is required.");
					let self = await locateSelf();
					const all = await listWindowPanes(self.windowId);
					if (all.some((p) => !owned(p))) throw new Error("Pi's window contains unrelated or legacy panes; leave them untouched. Move/close them yourself before starting workers.");
					const existing = all.find((p) => p.name === pane);
					if (existing?.alive && !restart) throw new Error(`Pane '${pane}' is still ${status(existing)}. Use restart:true to replace it.`);
					if (existing) await checked(["kill-pane", "-t", existing.paneId]);
					if (self.zoomed) {
						await checked(["resize-pane", "-Z", "-t", myPaneId]);
						self = await locateSelf();
					}
					const column = (await listWindowPanes(self.windowId)).filter(owned);
					// Split the largest tile, not the smallest bottom tile: use all
					// available height before reporting genuine capacity exhaustion.
					const largest = column.reduce<PaneInfo | undefined>((best, p) => !best || p.height > best.height ? p : best, undefined);
					const args = ["split-window", "-d", "-P", "-F", "#{pane_id}"];
					if (!largest) args.push("-f", "-h", "-l", "50%", "-t", myPaneId);
					else args.push("-v", "-t", largest.paneId);
					args.push("-c", cwd || ctx.cwd);
					// No terminal typing, interactive startup, history expansion, or
					// command echo. Set remain-on-exit in the child before exec so
					// even an instant exit keeps its real status and output.
					const launch = 'tmux set-option -p -t "$TMUX_PANE" remain-on-exit on && exec /bin/bash -c ' + quote(command);
					args.push("/bin/bash -c " + quote(launch));
					const result = await tmux(args);
					if (result.code !== 0) throw new Error(`Cannot create worker: ${result.stderr.trim()}. Stop an unused owned pane or enlarge the window; do not open another session/window.`);
					const newPaneId = result.stdout.trim();
					try {
						await checked(["set-option", "-p", "-t", newPaneId, "@pi_name", pane!]);
						await checked(["set-option", "-p", "-t", newPaneId, "@pi_owner", myPaneId]);
						await rebalance();
					} catch (error) {
						await tmux(["kill-pane", "-t", newPaneId]);
						throw error;
					}
					return { content: [{ type: "text", text: `Started '${pane}' (${newPaneId}). Use read for output and exit status.` }],
						details: { action, pane, paneId: newPaneId } };
				}
				if (action === "list") {
					const self = await locateSelf();
					const panes = await listWindowPanes(self.windowId);
					return { content: [{ type: "text", text: panes.map((p) => `${p.name || p.paneId}: ${status(p)} [${p.paneId}]${owned(p) ? "" : " (unmanaged; read-only)"}`).join("\n") || "No worker panes." }], details: { action, panes } };
				}
				const existing = await findPane(pane!);
				if (!existing) throw new Error(`Owned pane '${pane}' not found. Use list to inspect panes.`);
				if (action === "read") {
					const truncation = truncateTail(await capturePane(existing.paneId, params.lines ?? 20), { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
					return { content: [{ type: "text", text: `${pane}: ${status(existing)}\n${truncation.truncated ? "[Output truncated]\n" : ""}${truncation.content}` }],
						details: { action, pane, alive: existing.alive, exitCode: existing.exitCode, exitSignal: existing.exitSignal } };
				}
				if (action === "send") {
					if (!existing.alive) throw new Error(`Pane '${pane}' has ${status(existing)}; use run to replace it.`);
					if (!params.keys && !params.text) throw new Error("keys or text is required for send");
					if (params.text) await checked(["send-keys", "-l", "-t", existing.paneId, "--", params.text]);
					if (params.keys) await checked(["send-keys", "-t", existing.paneId, "--", ...params.keys.split(/\s+/).filter(Boolean)]);
					return { content: [{ type: "text", text: `Sent input to '${pane}'.` }], details: { action, pane } };
				}
				await checked(["kill-pane", "-t", existing.paneId]);
				await rebalance();
				return { content: [{ type: "text", text: `Stopped '${pane}'.` }], details: { action, pane } };
			});
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("tmux ")) + theme.fg("accent", `${args.action || "?"} ${args.pane || ""}`), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const text = result.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") || "";
			return new Text(theme.fg("dim", expanded ? text : text.split("\n")[0]), 0, 0);
		},
	});
}
