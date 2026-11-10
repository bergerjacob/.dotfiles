/** Repo-owned rolling fork of @davecodes/pi-dcp 0.2.0. AGPL-3.0-or-later. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./vendor/lib/config.ts";
import { createSessionState, type CompressionRecord } from "./vendor/lib/state.ts";
import { ENTRY, REMINDER, type Message, rollingPolicy, actionablePolicy, resolveTargetsDetailed, notifyHistoryRewritten, replay, project, nudge, endpointHint, estimateMessage, contextUsagePending } from "./core.ts";

export default function dcp(pi: ExtensionAPI): void {
	const loaded = loadConfig(process.cwd());
	if (!loaded.enabled) return;
	// Subagent children are short-lived: keep passive pruning and the tool, but no iteration-count nudges.
	const config = process.env.PI_SUBAGENT_CHILD === "1" ? { ...loaded, compress: { ...loaded.compress, iterationNudgeThreshold: 0 } } : loaded;
	const state = createSessionState();
	const restore = (ctx: ExtensionContext) => replay(ctx.sessionManager.getBranch() as unknown as Parameters<typeof replay>[0], state, config);
	const view = (ctx: ExtensionContext) => ctx.sessionManager.buildSessionProjection().messages as unknown as Message[];
	const policy = (messages: Message[], ctx: ExtensionContext) => rollingPolicy(messages, config, ctx.model, Math.ceil(Buffer.byteLength(ctx.getSystemPrompt(), "utf8") / 3));
	const display = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const active = [...state.compressions.values()].filter(r => !r.suspended).length;
		const pending = contextUsagePending(ctx.sessionManager.getBranch() as unknown as Parameters<typeof contextUsagePending>[0]);
		// Do not substitute raw byte/signature estimates for the footer's provider usage.
		ctx.ui.setStatus("dcp", active || pending ? `DCP ${active} active${pending ? "; context % pending response" : ""}` : undefined);
	};
	const refresh = (ctx: ExtensionContext) => { restore(ctx); display(ctx); };
	pi.on("session_start", (_event, ctx) => { refresh(ctx); });
	pi.on("session_tree", (_event, ctx) => { refresh(ctx); });
	// message_end runs before persistence; turn_end sees the finalized usage and results.
	pi.on("turn_end", (_event, ctx) => { refresh(ctx); });
	pi.on("context", (event, ctx) => {
		restore(ctx);
		const messages = event.messages as unknown as Message[];
		const protection = policy(messages, ctx);
		const actionable = actionablePolicy(protection, messages, state);
		const projected = nudge(project(messages, config, state, protection), config, state, actionable, ctx.model ?? {});
		// Opt-in diagnostics for live tests: PI_DCP_TRACE=/path/file.jsonl records every context pass.
		if (process.env.PI_DCP_TRACE) try {
			appendFileSync(process.env.PI_DCP_TRACE, JSON.stringify({ at: Date.now(), model: ctx.model?.id, messages: messages.length, projected: projected.length, tokens: projected.reduce((n, m) => n + estimateMessage(m), 0), rawTokens: messages.reduce((n, m) => n + estimateMessage(m), 0), providerContext: ctx.getContextUsage?.(), eligible: actionable.eligibleIds.length, savings: actionable.savings, budget: protection.budget, records: [...state.compressions.values()].filter(r => !r.suspended).length, nudged: projected.some(m => (m as { customType?: string }).customType === REMINDER), nudgeCount: state.nudgeFetchCount }) + "\n");
		} catch { /* diagnostics only */ }
		display(ctx);
		return { messages: projected as unknown as typeof event.messages };
	});
	// Best effort: telling the bridge about the rewrite must never fail or undo a compression.
	const rewritten = (ctx: ExtensionContext, event: string) => { refresh(ctx); try { notifyHistoryRewritten(ctx.sessionManager.getSessionId(), `dcp:${event}`); } catch { /* ignore */ } };
	const store = (ids: string[], topic: string, summary: string, skipped = 0, ctx?: ExtensionContext) => {
		const record: CompressionRecord = { id: state.nextCompressionId++, createdAt: Date.now(), toolCallIds: ids, topic, summary, tokensSaved: 0, suspended: false };
		// Prompt mid-run durability, even before agent_end; branch entry is authoritative.
		pi.appendEntry(ENTRY, { record });
		state.compressions.set(record.id, record);
		if (ctx) rewritten(ctx, "compress");
		return { content: [{ type: "text" as const, text: `Compression #${record.id} stored over ${ids.length} results${skipped ? ` (${skipped} pinned/protected/already-compressed results in the range were left intact)` : ""}. Summary will appear once on the first compressed result of the next request. /dcp decompress ${record.id} restores originals.` }], details: { record, compressionId: record.id, resolvedToolCallIds: ids } };
	};
	const fields = { topic: Type.String({ minLength: 3, maxLength: 120 }), summary: Type.String({ minLength: 30, description: "Factual technical summary: paths, findings, decisions, unresolved work. Preserve original instructions." }) };
	const description = "Compress OLD tool results from a closed work-stream. Use eligible endpoint IDs in DCP reminders. Latest rolling token suffix, incomplete/parallel batches and mutation/skill tools are protected: a range may span them, and they are skipped while the eligible results inside it are compressed. Unknown endpoints or a range with nothing eligible are refused; do not retry unchanged until eligibility changes. Original user instructions are never removed. No eligible results is not evidence of context exhaustion: continue the task without compression.";
	if (config.compress.permission !== "deny") {
		const execute = async (params: { toolCallIds?: string[]; startToolCallId?: string; endToolCallId?: string; topic: string; summary: string }, ctx: ExtensionContext) => {
			restore(ctx);
			try {
				if (state.manualMode) throw new Error("Manual mode enabled; use /dcp manual off or /dcp sweep.");
				const messages = view(ctx);
				const { ids, skipped } = resolveTargetsDetailed(messages, actionablePolicy(policy(messages, ctx), messages, state), params);
				if (config.compress.permission === "ask" && (!ctx.hasUI || !await ctx.ui.confirm("DCP compression", `Compress ${ids.length} old results?`))) throw new Error("Compression not approved.");
				return store(ids, params.topic, params.summary, skipped, ctx);
			} catch (error) {
				return { content: [{ type: "text" as const, text: `compress refused: ${String(error)}` }], details: { refused: true, reason: String(error) } };
			}
		};
		if (config.compress.mode === "message") pi.registerTool({ name: "compress", label: "Compress", description, executionMode: "sequential", parameters: Type.Object({ toolCallIds: Type.Array(Type.String(), { minItems: 1 }), ...fields }), execute: async (_id, params, _signal, _update, ctx) => execute(params, ctx) });
		else pi.registerTool({ name: "compress", label: "Compress", description, executionMode: "sequential", parameters: Type.Object({ startToolCallId: Type.String(), endToolCallId: Type.String(), ...fields }), execute: async (_id, params, _signal, _update, ctx) => execute(params, ctx) });
	}
	pi.registerCommand("dcp", {
		description: "Rolling DCP: context, stats, sweep [n], manual on|off, decompress ID, recompress ID",
		async handler(args, ctx) {
			restore(ctx);
			const [command, arg] = args.trim().split(/\s+/);
			const notify = (text: string) => ctx.ui.notify(text, "info");
			if (command === "manual") {
				if (arg !== "on" && arg !== "off") return notify(`Manual mode ${state.manualMode ? "on" : "off"}. Usage: /dcp manual on|off`);
				pi.appendEntry(ENTRY, { manualMode: arg === "on" }); return notify(`Manual mode ${arg}`);
			}
			if (command === "decompress" || command === "recompress") {
				const id = /^\d+$/.test(arg ?? "") ? Number(arg) : NaN;
				if (!state.compressions.has(id)) return notify("Unknown compression ID. /dcp stats lists records.");
				pi.appendEntry(ENTRY, { id, suspended: command === "decompress" }); rewritten(ctx, command); return notify(`Compression #${id} ${command === "decompress" ? "suspended" : "active"}`);
			}
			const messages = view(ctx), protection = actionablePolicy(policy(messages, ctx), messages, state);
			if (command === "sweep") {
				if (config.compress.permission === "deny") return notify("Compression denied by configuration.");
				if (arg && (!/^\d+$/.test(arg) || Number(arg) <= 0)) return notify("Usage: /dcp sweep [positive count]");
				const ids = arg ? protection.eligibleIds.slice(-Number(arg)) : protection.eligibleIds;
				if (!ids.length) return notify(endpointHint(protection));
				store(ids, "manual sweep", "Manual sweep: original outputs removed without a factual summary. Decompress to recover them.", 0, ctx); return notify(`Swept ${ids.length} eligible results.`);
			}
			notify(`${endpointHint(protection)}\nSession stats: ${JSON.stringify(state.stats)}\nRecords: ${[...state.compressions.values()].map(r => `#${r.id} ${r.suspended ? "suspended" : "active"}: ${r.topic}`).join("; ")}\nFooter context % uses the last valid provider response plus trailing-message estimates; a rewrite is reflected in measured usage after the next response. DCP byte estimates can include opaque reasoning signatures and are not provider token counts.\nNative compaction remains disabled; pinned/prose/arguments growth can require a fresh session.`);
		},
	});
}
