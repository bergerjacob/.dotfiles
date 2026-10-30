import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { refreshWayland } from "./runtime-health/desktop.ts";

const ENTRY = "dotfiles.compaction";

export default function (pi: ExtensionAPI) {
	let started: number | undefined;
	pi.on("session_start", async () => { await refreshWayland(); });
	pi.on("session_before_compact", (event, ctx) => {
		started = Date.now();
		pi.appendEntry(ENTRY, { state: "started", at: started, reason: event.reason,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			estimatedTokensBefore: event.preparation.tokensBefore });
	});
	pi.on("session_compact", () => {
		pi.appendEntry(ENTRY, { state: "completed", at: Date.now(), durationMs: started === undefined ? undefined : Date.now() - started });
		started = undefined;
	});
	pi.on("session_compact_failed", (event) => {
		// No prompts, response bodies or credential-bearing provider errors in
		// telemetry. Pi's own error UI retains the detailed diagnostic.
		pi.appendEntry(ENTRY, { state: event.aborted ? "aborted" : "failed", reason: event.reason,
			at: Date.now(), durationMs: started === undefined ? undefined : Date.now() - started });
		started = undefined;
	});
	pi.registerCommand("pi-health", {
		description: "Local Pi health: model/context, compaction history, sandbox configuration and clipboard environment (no network calls)",
		handler: async (_args, ctx) => {
			const repaired = await refreshWayland();
			const agentDir = process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent");
			let sandbox = "unknown";
			try { sandbox = JSON.parse(await readFile(join(agentDir, "sandbox.json"), "utf8")).enabled ? "enabled in managed config" : "disabled in managed config"; } catch { /* optional config */ }
			const recent = ctx.sessionManager.getBranch().filter((entry: any) => entry.type === "custom" && entry.customType === ENTRY).slice(-3);
			const usage = ctx.getContextUsage();
			const lines = [
				`Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}`,
				`Context estimate: ${usage?.tokens ?? "unknown"} / ${usage?.contextWindow ?? ctx.model?.contextWindow ?? "unknown"}`,
				`Sandbox: ${sandbox}; per-session toggle may differ. Use /sandbox for effective state.`,
				"Sandbox ps/localhost checks cannot prove host processes or servers are down. Never remove a dev lock/cache on that evidence.",
				`Wayland: ${process.env.WAYLAND_DISPLAY || "not set"}${repaired ? " (repaired for Pi and future children)" : ""}; DISPLAY: ${process.env.DISPLAY ? "set" : "not set"}`,
				"Browser QA: dotfiles-browser <unique-session> <command>; keep all commands in the same approved execution environment.",
				...recent.map((entry: any) => `Compaction: ${entry.data?.state ?? "unknown"}${entry.data?.durationMs === undefined ? "" : ` (${entry.data.durationMs}ms)`}`),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
