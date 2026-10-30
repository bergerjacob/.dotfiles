import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

test("browser wrapper scopes socket/session, preserves XDG and bounds CLI calls", { timeout: 10000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), "browser-wrapper-test-"));
	const session = `test-${process.pid}`;
	const runtime = `/tmp/dotfiles-browser-${process.getuid!()}/${session}`;
	const wrapper = resolve("bin/dotfiles-browser");
	try {
		await writeFile(join(dir, "agent-browser"), "#!/usr/bin/env node\nconst fs=require('fs');fs.writeFileSync(process.env.RESULT, JSON.stringify({args:process.argv.slice(2),socket:process.env.AGENT_BROWSER_SOCKET_DIR,xdg:process.env.XDG_RUNTIME_DIR,profile:process.env.AGENT_BROWSER_PROFILE}));if(process.argv.includes('hang'))setTimeout(()=>{},10000);", { mode: 0o700 });
		const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, RESULT: join(dir, "result"), XDG_RUNTIME_DIR: "/readonly/runtime", AGENT_BROWSER_PROFILE: "personal", DOTFILES_BROWSER_TIMEOUT_SECONDS: "1" };
		await exec(wrapper, [session, "open", "about:blank"], { env, timeout: 4000 });
		const result = JSON.parse(await readFile(join(dir, "result"), "utf8"));
		assert.deepEqual(result.args, ["--session", session, "open", "about:blank"]);
		assert.equal(result.socket, runtime);
		assert.equal(result.xdg, "/readonly/runtime");
		assert.equal(result.profile, undefined);
		assert.equal((await stat(runtime)).mode & 0o777, 0o700);
		await assert.rejects(exec(wrapper, [session, "close", "--all"], { env }), /only controls its named isolated session/);
		await assert.rejects(exec(wrapper, ["../unsafe", "open", "about:blank"], { env }), /Invalid session/);
		await assert.rejects(exec(wrapper, [session, "hang"], { env, timeout: 4000 }), (e: any) => e.code === 124);
		await writeFile(join(dir, "agent-browser"), "#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);fs.writeFileSync(process.env.RESULT,JSON.stringify({args}));if(!process.env.IGNORE_SCREENSHOT)fs.writeFileSync(args.at(-1),'synthetic png');", { mode: 0o700 });
		await exec(wrapper, [session, "screenshot", "shot with spaces.png", "--full"], { env, cwd: dir });
		let args = JSON.parse(await readFile(join(dir, "result"), "utf8")).args;
		assert.deepEqual(args, ["--session", session, "screenshot", "--full", join(dir, "shot with spaces.png")]);
		assert.equal(await readFile(join(dir, "shot with spaces.png"), "utf8"), "synthetic png");
		await exec(wrapper, [session, "screenshot", "main", "selected.png", "--screenshot-quality", "80", "--full"], { env, cwd: dir });
		args = JSON.parse(await readFile(join(dir, "result"), "utf8")).args;
		assert.deepEqual(args, ["--session", session, "screenshot", "--screenshot-quality", "80", "--full", "main", join(dir, "selected.png")]);
		await assert.rejects(exec(wrapper, [session, "screenshot", "missing.png", "--full"], { env: { ...env, IGNORE_SCREENSHOT: "1" }, cwd: dir }), /did not create or update screenshot/);
		await assert.rejects(exec(wrapper, [session, "screenshot", "shot with spaces.png", "--full"], { env: { ...env, IGNORE_SCREENSHOT: "1" }, cwd: dir }), /did not create or update screenshot/);
	} finally {
		await rm(runtime, { recursive: true, force: true });
		await rm(dir, { recursive: true, force: true });
	}
});
