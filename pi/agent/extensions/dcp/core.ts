/** Rolling DCP fork core. AGPL-3.0-or-later; see UPSTREAM.md. */
import { ALWAYS_PROTECTED_TOOLS, type DcpConfig, resolveModelLimit } from "./vendor/lib/config.ts";
import { type AnyMessage, isAssistant, isToolResult, toolCallsOf, toolResultTokens, cloneForMutation, compressionPlaceholderToolResult, approxTokens } from "./vendor/lib/messages.ts";
import { type CompressionRecord, type SessionState } from "./vendor/lib/state.ts";
import { applyDeduplication } from "./vendor/lib/strategies/deduplication.ts";
import { applyPurgeErrors } from "./vendor/lib/strategies/purge-errors.ts";

export type Message = AnyMessage;
export interface ModelBudget { contextWindow?: number; maxTokens?: number; provider?: string; id?: string }
export const ENTRY = "dotfiles-dcp-v1";
export const SUMMARY = "dotfiles-dcp-summary";
export const REMINDER = "dotfiles-dcp-reminder";
export function isGenerated(m: Message): boolean { return m.role as string === "custom" && [SUMMARY, REMINDER].includes(m.customType as string); }
export function estimateMessage(m: Message, imageTokens = 4096): number {
	const content = m.content;
	if (typeof content === "string") return 16 + approxTokens(content);
	// Pi's bashExecution/branchSummary/compactionSummary messages have no content.
	if (!Array.isArray(content)) return 16 + approxTokens([m.command, m.output, m.summary].filter(value => typeof value === "string").join("\n"));
	return 16 + content.reduce((n, c) => {
		if (c.type === "image") return n + imageTokens;
		if (c.type === "toolCall") return n + approxTokens(JSON.stringify(c));
		if (c.type === "thinking") return n + approxTokens(String(c.thinking ?? "")) + approxTokens(String(c.thinkingSignature ?? ""));
		return n + approxTokens(String(c.text ?? ""));
	}, 0);
}
function finite(n: number | undefined, fallback: number, min = 0): number { return n !== undefined && Number.isFinite(n) && n >= min ? n : fallback; }
export function rollingPolicy(messages: Message[], config: DcpConfig, model: ModelBudget = {}, systemTokens = 0) {
	const cfg = config.rollingProtection;
	const window = finite(model.contextWindow, 200_000, 1);
	const reserve = Math.max(finite(cfg.reserveTokens, 16384), finite(model.maxTokens, 0));
	const usable = Math.max(0, window - reserve - finite(systemTokens, 0));
	const budget = Math.floor(Math.min(finite(cfg.recentTokens, 100000), usable * Math.min(0.4, finite(cfg.maxWindowFraction, 0.4))));
	const protectedIds = new Set<string>();
	const calls = new Map<string, { index: number; name: string }>();
	const results = new Map<string, number>();
	const groups = new Map<number, string[]>();
	messages.forEach((m, index) => {
		if (isAssistant(m)) {
			const batch = toolCallsOf(m);
			groups.set(index, batch.map(c => c.id));
			for (const c of batch) calls.set(c.id, { index, name: c.name });
		}
		if (isToolResult(m)) results.set(m.toolCallId, index);
	});
	let retained = 0;
	let cutoff = messages.length;
	// Always include the crossing message, even if one enormous result exceeds budget.
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isGenerated(messages[i])) continue;
		cutoff = i;
		retained += estimateMessage(messages[i], finite(cfg.imageTokens, 4096));
		if (retained >= budget) break;
	}
	for (const [id, c] of calls) {
		if (c.index >= cutoff || (results.get(id) ?? -1) >= cutoff || !results.has(id)) protectedIds.add(id);
	}
	// Whole parallel batch closure: any recent/pending sibling protects all siblings.
	for (const ids of groups.values()) if (ids.some(id => protectedIds.has(id))) for (const id of ids) protectedIds.add(id);
	const pinned = new Set([...ALWAYS_PROTECTED_TOOLS, "apply_patch", ...config.compress.protectedTools]);
	for (const [id, c] of calls) if (pinned.has(c.name) || pinned.has(c.name.split(".").at(-1)!)) protectedIds.add(id);
	for (const m of messages) if (isAssistant(m)) for (const call of toolCallsOf(m)) {
		if (Object.values(call.arguments).some(value => typeof value === "string" && /(?:^|\/)SKILL\.md$/.test(value))) protectedIds.add(call.id);
	}
	const eligible = messages.filter(isToolResult).filter(m => calls.has(m.toolCallId) && !protectedIds.has(m.toolCallId) && !pinned.has(m.toolName));
	const eligibleIds = eligible.map(m => m.toolCallId);
	const savings = eligible.reduce((n, m) => n + Math.max(0, toolResultTokens(m) - 40), 0);
	return { protectedIds, eligibleIds, savings, budget, cutoff, retained, usable };
}
export type Policy = ReturnType<typeof rollingPolicy>;
/** Already-replaced outputs are not actionable savings or new compression targets. */
export function actionablePolicy(policy: Policy, messages: Message[], state: SessionState): Policy {
	const replaced = new Set<string>();
	for (const rec of state.compressions.values()) {
		if (!rec.suspended && !rec.toolCallIds.some(id => policy.protectedIds.has(id))) for (const id of rec.toolCallIds) replaced.add(id);
	}
	const eligibleIds = policy.eligibleIds.filter(id => !replaced.has(id));
	const allowed = new Set(eligibleIds);
	const savings = messages.filter(isToolResult).filter(m => allowed.has(m.toolCallId)).reduce((n, m) => n + Math.max(0, toolResultTokens(m) - 40), 0);
	return { ...policy, eligibleIds, savings };
}
export function endpointHint(policy: Policy): string {
	return policy.eligibleIds.length ? `Eligible endpoints: ${policy.eligibleIds[0]} .. ${policy.eligibleIds.at(-1)}; estimated reclaimable ${policy.savings} tokens. Protected suffix budget ${policy.budget}.` : `No eligible endpoints; protected suffix budget ${policy.budget}. Do not retry until eligibility changes.`;
}
export function resolveTargets(messages: Message[], policy: Policy, params: { toolCallIds?: string[]; startToolCallId?: string; endToolCallId?: string }): string[] {
	let ids = params.toolCallIds;
	if (!ids) {
		const ordered = messages.filter(isToolResult).map(m => m.toolCallId);
		const start = ordered.indexOf(params.startToolCallId ?? "");
		const end = ordered.indexOf(params.endToolCallId ?? "");
		if (start < 0 || end < 0) throw new Error(`Unknown endpoint. ${endpointHint(policy)}`);
		ids = ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
	}
	ids = [...new Set(ids)];
	const eligible = new Set(policy.eligibleIds);
	if (!ids.length || ids.some(id => !eligible.has(id))) throw new Error(`protected_window_overlap or unknown/pinned ID: atomic refusal. ${endpointHint(policy)}`);
	return ids;
}
interface BranchEntry { type?: string; customType?: string; data?: unknown; message?: Message }
interface Change { record?: CompressionRecord; id?: number; suspended?: boolean; manualMode?: boolean }
function validRecord(value: unknown): value is CompressionRecord {
	const r = value as CompressionRecord | undefined;
	return !!r && Number.isSafeInteger(r.id) && r.id > 0 && typeof r.summary === "string" && typeof r.topic === "string" && Array.isArray(r.toolCallIds) && r.toolCallIds.every(id => typeof id === "string");
}
/** Authoritative active-branch replay; external upstream JSON intentionally ignored. */
export function replay(branch: readonly BranchEntry[], state: SessionState, config: DcpConfig): void {
	state.compressions.clear();
	state.nextCompressionId = 1;
	state.manualMode = config.manualMode.enabled;
	const args = new Map<string, Record<string, unknown>>();
	const messages = branch.filter(e => e.type === "message" && e.message).map(e => e.message!);
	for (const e of branch) {
		if (e.type === "custom" && e.customType === ENTRY) {
			const change = e.data as Change | undefined;
			if (validRecord(change?.record)) state.compressions.set(change.record.id, structuredClone(change.record));
			if (typeof change?.manualMode === "boolean") state.manualMode = change.manualMode;
			if (change?.id && typeof change.suspended === "boolean") {
				const r = state.compressions.get(change.id); if (r) r.suspended = change.suspended;
			}
		}
		const m = e.message;
		if (!m) continue;
		if (isAssistant(m)) for (const c of toolCallsOf(m)) if (c.name === "compress") args.set(c.id, c.arguments);
		if (!isToolResult(m) || m.toolName !== "compress" || m.isError) continue;
		const d = m.details as { record?: CompressionRecord; compressionId?: number; resolvedToolCallIds?: string[]; refused?: boolean } | undefined;
		if (d?.refused) continue;
		if (validRecord(d?.record)) { state.compressions.set(d.record.id, structuredClone(d.record)); continue; }
		// Successful legacy 0.2.0 result: recover summary from matching call args.
		const a = args.get(m.toolCallId);
		if (!d?.compressionId || !a || typeof a.summary !== "string") continue;
		let ids = d.resolvedToolCallIds ?? a.toolCallIds as string[] | undefined;
		if (!ids && typeof a.startToolCallId === "string" && typeof a.endToolCallId === "string") {
			const ordered = messages.filter(isToolResult).map(x => x.toolCallId);
			const lo = ordered.indexOf(a.startToolCallId), hi = ordered.indexOf(a.endToolCallId);
			if (lo >= 0 && hi >= 0) ids = ordered.slice(Math.min(lo, hi), Math.max(lo, hi) + 1);
		}
		if (ids) state.compressions.set(d.compressionId, { id: d.compressionId, createdAt: m.timestamp, summary: a.summary, topic: String(a.topic ?? "legacy compression"), toolCallIds: ids, tokensSaved: 0, suspended: false });
	}
	for (const id of state.compressions.keys()) state.nextCompressionId = Math.max(state.nextCompressionId, id + 1);
}
// Generated messages are replayed as user-role turns at the tail of the request. Keep them at the
// tail (after the stable cacheable prefix) and make their text deterministic; the framing tells the
// model they are automatic context, so it does not narrate them as an empty user message.
const NOTICE = "Automatic DCP context, not from the user: do not acknowledge, mention or reply to it; continue the task in progress.";
function custom(customType: string, text: string): Message {
	return { role: "custom", customType, content: text, display: false, timestamp: 0 } as unknown as Message;
}
/** Every projection starts from originals. Stats sets suppress counting, never transformations. */
export function project(original: Message[], config: DcpConfig, state: SessionState, policy: Policy): Message[] {
	const messages = original.filter(m => !isGenerated(m)).map(cloneForMutation);
	const active = [...state.compressions.values()].filter(r => !r.suspended);
	// Replay records atomically: never partially apply a now-protected range.
	const applicable = active.filter(r => !r.toolCallIds.some(id => policy.protectedIds.has(id)));
	const targets = new Map(applicable.flatMap(r => r.toolCallIds.map(id => [id, r] as const)));
	for (const m of messages) {
		if (isToolResult(m)) {
			const rec = targets.get(m.toolCallId);
			if (!rec || !policy.eligibleIds.includes(m.toolCallId)) continue;
			const saved = compressionPlaceholderToolResult(m, rec.id, rec.topic);
			if (!state.appliedCompressionTargets.has(m.toolCallId)) {
				state.appliedCompressionTargets.add(m.toolCallId); state.stats.compressionsApplied++; state.stats.tokensSaved += saved;
			}
		}
		// Summary lives in one explicit request-local record, not repeated in arguments.
		if (isAssistant(m)) for (const c of toolCallsOf(m)) if (c.name === "compress" && typeof c.arguments.summary === "string") c.arguments = { ...c.arguments, summary: "[summary in DCP active-record context]" };
	}
	if (!(state.manualMode && !config.manualMode.automaticStrategies)) {
		applyDeduplication(messages, config, state, policy.protectedIds);
		// Context-derived age: stable over reloads, independent of turnIndex resets.
		let clock = 0; state.erroredAt.clear();
		for (const m of messages) {
			if (isAssistant(m)) clock++;
			if (isToolResult(m) && m.isError) state.erroredAt.set(m.toolCallId, clock);
		}
		state.turnIndex = clock;
		applyPurgeErrors(messages, config, state, policy.protectedIds);
	}
	for (const rec of active) messages.push(custom(SUMMARY, `[${NOTICE}]\n[DCP active record #${rec.id}: ${rec.topic}]\n${rec.summary}`));
	return messages;
}
export function nudge(messages: Message[], config: DcpConfig, state: SessionState, policy: Policy, model: ModelBudget): Message[] {
	state.nudgeFetchCount++;
	if (config.compress.permission === "deny" || state.manualMode || !policy.eligibleIds.length || policy.savings <= 0) return messages;
	const count = state.nudgeFetchCount;
	const tokens = messages.reduce((n, m) => n + estimateMessage(m), 0);
	const floor = resolveModelLimit(config.compress.minContextLimit, config.compress.modelMinLimits, model, model.contextWindow);
	const ceiling = resolveModelLimit(config.compress.maxContextLimit, config.compress.modelMaxLimits, model, model.contextWindow);
	const iterations = config.compress.iterationNudgeThreshold;
	const iteration = iterations > 0 && count - state.lastIterationNudgeAt >= iterations;
	const throttle = count % Math.max(1, config.compress.nudgeFrequency) === 0 && count - state.lastSoftNudgeTurn >= Math.max(1, config.compress.nudgeEveryTurns);
	if (!iteration && !(tokens >= floor && throttle)) return messages;
	state.lastIterationNudgeAt = count; state.lastSoftNudgeTurn = count;
	return [...messages, custom(REMINDER, `[${NOTICE}]\n[DCP request-local reminder${tokens >= ceiling ? "; context pressure high" : ""}] Compress a closed eligible work-stream with a factual summary if useful. ${endpointHint(policy)} Never retry protected IDs until eligibility changes. User instructions, prose, arguments and pinned outputs still grow; this is not an unlimited-context guarantee.`)];
}
