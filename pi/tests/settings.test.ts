import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { jiti, requirePi } from "./helpers.ts";

test("native automatic compaction stays disabled while manual budgets remain valid", async () => {
	const settings = JSON.parse(await readFile(new URL("../agent/settings.json", import.meta.url), "utf8"));
	const { SettingsManager, AgentSession, shouldCompact } = await jiti.import(requirePi.resolve("./dist/index.js"));
	const manager = SettingsManager.inMemory(settings);
	assert.equal(manager.getCompactionEnabled(), false);
	// Exercise the installed post-run guard, including overflow/length-shaped
	// responses. No session/provider is constructed: disabled means early return.
	for (const stopReason of ["stop", "error", "length"]) {
		assert.equal(await AgentSession.prototype._checkCompaction.call({ settingsManager: manager },
			{ stopReason, errorMessage: "context_length_exceeded" }, false), false);
	}
	for (const [provider, id, window] of [
		["openai-codex", "gpt-6.1-sol", 500000], ["openai-codex", "gpt-6-luna", 272000],
		["openai-codex", "gpt-6-astra", 272000], ["zai", "glm-5.3", 1000000],
		["opencode-go", "deepseek-v4.1-flash", 1000000], ["opencode-go", "kimi-k3", 1048576],
		["claude-bridge", "claude-sonnet-5-5", 1000000],
	] as const) {
		const effective = manager.getCompactionSettings({ provider, id });
		assert.equal(effective.enabled, false);
		assert.equal(shouldCompact(window + 1, window, effective), false);
		assert.equal(effective.keepRecentTokens, 20000);
		assert.equal(effective.reserveTokens / window, 0.25);
	}
	assert.equal(manager.getCompactionSettings({ provider: "test", id: "smaller-model" }).reserveTokens, 32768);
	assert.equal(settings.retry.maxRetries, 3);
	assert.equal(settings.retry.baseDelayMs, 2000);
});

test("DCP remains automatic and protected without a native-compaction fallback", async () => {
	const config = JSON.parse(await readFile(new URL("../agent/pi-dcp.json", import.meta.url), "utf8"));
	assert.equal(config.enabled, true);
	assert.equal(config.manualMode.enabled, false);
	assert.equal(config.manualMode.automaticStrategies, true);
	assert.equal(config.compress.permission, "allow");
	assert.equal(config.compress.nudgeForce, "strong");
	assert.equal(config.strategies.deduplication.enabled, true);
	assert.equal(config.strategies.purgeErrors.enabled, true);
	assert.equal(config.turnProtection.enabled, false);
	assert.equal(config.rollingProtection.recentTokens, 100000);
	assert.equal(config.rollingProtection.maxWindowFraction, 0.4);
	assert(config.rollingProtection.reserveTokens >= 16384);
});

test("Alt+Shift+G workaround still matches the installed TUI parser", async () => {
	const { matchesKey } = await jiti.import(requirePi.resolve("./node_modules/@earendil-works/pi-tui/dist/index.js"));
	assert.equal(matchesKey("\x1b[103;4u", "alt+shift+g"), true);
	const tmux = await readFile(new URL("../../tmux.conf", import.meta.url), "utf8");
	assert(tmux.includes('bind-key -n M-G send-keys -l "\\e[103;4u"'));
});
