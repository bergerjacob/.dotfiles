import { test } from "node:test";
import assert from "node:assert/strict";
import { jiti } from "./helpers.ts";
const { default: autoResume, classify } = await jiti.import("../agent/extensions/auto-resume.ts");

const QUOTA = "Claude quota exceeded — rate limit (five_hour) — resets 1:00:00 PM: You've hit your session limit · resets 1pm (America/Los_Angeles)";

test("claude bridge quota message waits for the reset time", () => {
	const now = new Date();
	now.setHours(10, 10, 0, 0);
	const verdict = classify(QUOTA, now.getTime());
	assert.equal(verdict.kind, "quota");
	assert.equal(verdict.delayMs, 170 * 60_000);
});

function run(sendUserMessage: () => unknown, idle: () => boolean) {
	const handlers: Record<string, any> = {};
	autoResume({ on: (name: string, fn: any) => (handlers[name] = fn), sendUserMessage });
	const realSetTimeout = globalThis.setTimeout;
	(globalThis as any).setTimeout = (fn: () => void) => realSetTimeout(fn, 5);
	try {
		handlers.agent_start();
		handlers.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" } });
		handlers.agent_settled({ aborted: false }, { hasUI: false, isIdle: idle });
	} finally {
		(globalThis as any).setTimeout = realSetTimeout;
	}
}

test("timer fires without crashing when sendUserMessage returns void", async () => {
	let sent = 0;
	run(() => { sent++; return undefined; }, () => true);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(sent, 1);
});

test("timer survives a stale ctx and a rejecting sendUserMessage", async () => {
	run(() => Promise.reject(new Error("nope")), () => { throw new Error("stale"); });
	await new Promise((resolve) => setTimeout(resolve, 50));
});
