import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiti } from "./helpers.ts";
const { default: secretMask } = await jiti.import("../agent/extensions/secret-mask.ts");

test("credentials are masked but public config, selectors, class names, URLs and model IDs survive", async () => {
	const dir = await mkdtemp(join(tmpdir(), "secret-mask-test-"));
	const home = process.env.HOME;
	process.env.HOME = dir;
	try {
		const token = "credential-123456789";
		const env = `API_KEY=${token}\nPASSWORD=postgres\nMODEL=openai-codex/example-model\nBASE_URL=http://localhost:3000\nCLASS=max-w-7xl\nSELECTOR=#home-hero\nDATABASE_URL=postgres://user:pass@localhost/db\n`;
		await writeFile(join(dir, ".env"), env);
		const handlers = new Map<string, any>();
		secretMask({ on: (name: string, fn: any) => handlers.set(name, fn), registerCommand() {} });
		assert(!handlers.has("tool_call"), "must never change command arguments");
		const text = `${token} postgres openai-codex/example-model http://localhost:3000 max-w-7xl #home-hero postgres://user:pass@localhost/db sk-${"a".repeat(30)}`;
		const buffer = Buffer.from("preserve binary");
		const result = await handlers.get("tool_result")({ toolName: "custom-tool", content: [{ type: "text", text }],
			details: { token, buffer, nested: [token] }, structuredContent: { token, url: "http://localhost:3000" } }, { cwd: dir });
		assert.equal(result.content[0].text, "*** *** openai-codex/example-model http://localhost:3000 max-w-7xl #home-hero *** ***");
		assert.equal(result.details.token, "***");
		assert.equal(result.details.nested[0], "***");
		assert.equal(result.details.buffer, buffer);
		assert.deepEqual(result.structuredContent, { token: "***", url: "http://localhost:3000" });
		assert.equal(await readFile(join(dir, ".env"), "utf8"), env);
	} finally { if (home === undefined) delete process.env.HOME; else process.env.HOME = home; await rm(dir, { recursive: true, force: true }); }
});

test("nested auth tokens, custom secret keys and cache invalidation across configurations", async () => {
	const dir = await mkdtemp(join(tmpdir(), "secret-mask-config-test-"));
	const home = process.env.HOME;
	process.env.HOME = dir;
	try {
		await mkdir(join(dir, ".pi"));
		await writeFile(join(dir, "auth.json"), JSON.stringify({ provider: { type: "oauth", access: "access-12345678", refresh: "refresh-12345678", apiKey: "apikey-12345678", model: "public/model-name" } }));
		await writeFile(join(dir, ".env"), "CUSTOM=custom-12345678\nPUBLIC=public-12345678\nINLINE_TOKEN=\"quoted-12345678\" # comment\nMULTILINE_SECRET=\"line-one-123\nline-two-456\"\n");
		const make = async (config: any) => {
			await writeFile(join(dir, ".pi/secret-mask.json"), JSON.stringify(config));
			const handlers = new Map<string, any>();
			secretMask({ on: (name: string, fn: any) => handlers.set(name, fn), registerCommand() {} });
			await handlers.get("session_start")({}, { cwd: dir, ui: { notify() {} } });
			return (text: string) => handlers.get("tool_result")({ toolName: "read", content: [{ type: "text", text }] }, { cwd: dir });
		};
		let scrub = await make({ secretFiles: ["auth.json", ".env"], sensitiveKeyPatterns: ["^custom$"] });
		let result = await scrub("access-12345678 refresh-12345678 apikey-12345678 public/model-name custom-12345678 public-12345678");
		assert.equal(result.content[0].text, "*** *** *** public/model-name *** public-12345678");
		result = await scrub("quoted-12345678 line-one-123\nline-two-456");
		assert.equal(result.content[0].text, "*** ***");
		scrub = await make({ secretFiles: ["auth.json", ".env"], maskAllValues: true, mask: "[redacted]" });
		result = await scrub("public/model-name public-12345678");
		assert.equal(result.content[0].text, "[redacted] [redacted]");
	} finally { if (home === undefined) delete process.env.HOME; else process.env.HOME = home; await rm(dir, { recursive: true, force: true }); }
});
