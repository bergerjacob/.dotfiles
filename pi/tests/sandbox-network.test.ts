import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { jiti, requirePi } from "./helpers.ts";
import { configureNodeProxy, proxyHealth, sandboxTransport, registerSandboxCodex } from "../agent/extensions/runtime-health/network.ts";

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
 const child = spawn(cmd, args, { env, timeout: 6000 });
 let out = "", err = "";
 child.stdout.on("data", d => out += d); child.stderr.on("data", d => err += d);
 child.on("error", reject); child.on("close", code => resolve({ code, out, err }));
});

test("Node proxy activation covers startup/toggle inheritance without overriding explicit settings", () => {
 for (const version of ["22.21.0", "24.0.0", "24.13.0", "25.0.0"]) {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(configureNodeProxy(env, version), true); assert.equal(env.NODE_USE_ENV_PROXY, "1");
  assert.equal(configureNodeProxy(env, version), false);
 }
 for (const version of ["20.19.0", "22.20.0", "23.11.0"]) assert.equal(configureNodeProxy({}, version), false);
 for (const value of ["0", "1", ""]) { const env = { NODE_USE_ENV_PROXY: value }; assert.equal(configureNodeProxy(env, "24.13.0"), false); assert.equal(env.NODE_USE_ENV_PROXY, value); }
 assert.equal(proxyHealth({ HTTPS_PROXY: "http://secret-user:secret-password@private.example:1234" }).includes("secret"), false);
});

test("registered sandbox stream delegates offline, preserving all options except automatic transport", () => {
 const calls: any[][] = [], stream = { fixture: true };
 const codex: any = { streamSimple: (...args: any[]) => { calls.push(args); return stream; } };
 let registered: any;
 const pi: any = { registerProvider: (name: string, config: any) => { assert.equal(name, "openai-codex"); registered = config; } };
 registerSandboxCodex(pi, codex, {}); assert.equal(registered, undefined);
 registerSandboxCodex(pi, codex, { SANDBOX_RUNTIME: "1" });
 const model = {}, context = {}, options = Object.freeze({ transport: "auto", apiKey: "fixture", signal: new AbortController().signal, headers: { "x-fixture": "preserve" }, maxTokens: 123, reasoning: "low", sessionId: "fixture" });
 assert.equal(registered.streamSimple(model, context, options), stream);
 assert.equal(calls[0][0], model); assert.equal(calls[0][1], context);
 assert.deepEqual(calls[0][2], { ...options, transport: "sse" });
 for (const transport of ["sse", "websocket", "websocket-cached"]) {
  registered.streamSimple(model, context, { ...options, transport });
  assert.equal(calls.at(-1)![2].transport, transport);
 }
});

test("sandbox SSE selection preserves host defaults, explicit transport and native Codex auth/catalog", async () => {
 assert.equal(sandboxTransport("auto", { SANDBOX_RUNTIME: "1" }), "sse");
 assert.equal(sandboxTransport(undefined, { SANDBOX_RUNTIME: "1" }), "sse");
 assert.equal(sandboxTransport("auto", {}), "auto");
 assert.equal(sandboxTransport("websocket", { SANDBOX_RUNTIME: "1" }), "websocket");
 assert.equal(sandboxTransport("sse", { SANDBOX_RUNTIME: "1" }), "sse");
 const { ModelRuntime } = await jiti.import(requirePi.resolve("./dist/index.js"));
 const { default: extension } = await jiti.import("../agent/extensions/runtime-health.ts");
 const registered: [string, any][] = [];
 const previous = process.env.SANDBOX_RUNTIME;
 try {
  for (const sandbox of [undefined, "1"]) {
   if (sandbox === undefined) delete process.env.SANDBOX_RUNTIME; else process.env.SANDBOX_RUNTIME = sandbox;
   extension({ on() {}, registerCommand() {}, registerProvider: (name: string, config: any) => registered.push([name, config]) });
   assert.equal(registered.length, sandbox === "1" ? 1 : 0, "host must not replace its transport");
  }
 } finally { if (previous === undefined) delete process.env.SANDBOX_RUNTIME; else process.env.SANDBOX_RUNTIME = previous; }
 assert.equal(registered[0][0], "openai-codex");
 assert.equal(registered[0][1].api, "openai-codex-responses");
 const dir = await mkdtemp(join(tmpdir(), "pi-native-auth-"));
 try {
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const before = runtime.getProvider("openai-codex"), models = runtime.getModels("openai-codex").map((m: any) => m.id);
  const nativeOAuth = before.auth.oauth;
  assert.ok(nativeOAuth?.refresh, "fixture must exercise the real native OAuth registration");
  runtime.registerProvider(...registered[0]);
  const oauth = runtime.getProvider("openai-codex").auth.oauth;
  assert.equal(oauth.refresh, nativeOAuth.refresh); assert.equal(oauth.login, nativeOAuth.login);
  assert.equal(oauth.isSubscription, nativeOAuth.isSubscription);
  const credential = { type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", expires: Date.now() + 3600000 };
  const normalized = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(normalized(await oauth.toAuth(credential)), normalized(await nativeOAuth.toAuth(credential)));
  assert.deepEqual(runtime.getModels("openai-codex").map((m: any) => m.id), models);
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test("managed allowlist covers real Codex/package hosts but keeps domain and credential restrictions", async () => {
 const config = JSON.parse(await readFile(new URL("../agent/sandbox.json", import.meta.url), "utf8"));
 const allowed = config.network.allowedDomains;
 for (const host of ["chatgpt.com", "auth.openai.com", "api.openai.com", "registry.npmjs.org", "registry.yarnpkg.com", "pypi.org", "files.pythonhosted.org"]) assert.ok(allowed.includes(host), host);
 assert.equal(config.enabled, true); assert.ok(!allowed.includes("*"));
 assert.ok(!allowed.includes("*.openai.com"));
 assert.ok(config.filesystem.denyWrite.includes("~/.pi/agent/auth.json"));
 assert.ok(config.filesystem.denyWrite.includes("~/.ssh"));
});

test("normal subprocess clients use authenticated CONNECT with proxy DNS, verified TLS and denied hosts", { timeout: 30000 }, async (t) => {
 const dir = await mkdtemp(join(tmpdir(), "pi-proxy-fixture-"));
 const keyPath = join(dir, "key.pem"), certPath = join(dir, "cert.pem");
 execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=allowed.fixture.test", "-addext", "subjectAltName=DNS:allowed.fixture.test"], { stdio: "ignore" });
 let codexRequests = 0;
 const target = httpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
  if (req.url === "/codex/responses") {
   codexRequests++;
   assert.equal(req.method, "POST"); assert.equal(req.headers["chatgpt-account-id"], "fixture-account");
   assert.equal(req.headers["x-fixture"], "preserve");
   res.setHeader("Content-Type", "text/event-stream");
   res.end("data: " + JSON.stringify({ type: "response.completed", response: { id: "fixture", status: "completed", output: [], usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55, input_tokens_details: { cached_tokens: 10 } } } }) + "\n\n");
   return;
  }
  if (req.url === "/sse") { res.setHeader("Content-Type", "text/event-stream"); res.end("data: fixture-ok\n\n"); }
  else res.end("fixture-ok");
 });
 target.on("upgrade", (req, socket) => {
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.end(Buffer.from([0x81, 10, ...Buffer.from("fixture-ok")]));
 });
 const auth = "Basic " + Buffer.from("fixture-user:fixture-password").toString("base64");
 const seen: string[] = [], sockets = new Set<any>();
 const proxy = httpServer((req, res) => {
  if (req.headers["proxy-authorization"] !== auth) { res.writeHead(407); res.end(); return; }
  if (new URL(req.url!).hostname !== "allowed.fixture.test") { res.writeHead(403); res.end(); return; }
  res.end("fixture-ok");
 });
 proxy.on("connect", (req, client, head) => {
  const host = req.url!.split(":")[0]; seen.push(host);
  if (req.headers["proxy-authorization"] !== auth) { client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"); return; }
  if (host !== "allowed.fixture.test") { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const port = (target.address() as any).port;
  const upstream = connect(port, "127.0.0.1", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
  sockets.add(upstream); sockets.add(client);
  upstream.on("error", () => client.destroy()); client.on("error", () => upstream.destroy());
  upstream.on("close", () => { sockets.delete(upstream); client.destroy(); }); client.on("close", () => { sockets.delete(client); upstream.destroy(); });
 });
 try {
  target.listen(0, "127.0.0.1"); await once(target, "listening");
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const proxyUrl = `http://fixture-user:fixture-password@127.0.0.1:${(proxy.address() as any).port}`;
  const env = { ...process.env, HTTPS_PROXY: proxyUrl, https_proxy: proxyUrl, HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, ALL_PROXY: proxyUrl, all_proxy: proxyUrl, NO_PROXY: "", no_proxy: "", NODE_EXTRA_CA_CERTS: certPath, NODE_USE_ENV_PROXY: "1" };
  const url = `https://allowed.fixture.test:${(target.address() as any).port}/`;
  const cases: [string, string, string[]][] = [
   ["curl", "curl", ["-fsS", "--max-time", "4", "--cacert", certPath, url]],
   ["Node SSE", process.execPath, ["-e", "fetch(process.argv[1],{signal:AbortSignal.timeout(4000)}).then(async r=>{if(r.headers.get('content-type')!=='text/event-stream')throw Error('not SSE');console.log(new TextDecoder().decode((await r.body.getReader().read()).value))}).catch(e=>{console.error(e.message);process.exitCode=1})", url + "sse"]],
   ["Node fetch", process.execPath, ["-e", "fetch(process.argv[1],{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)throw Error(r.status);return r.text()}).then(console.log).catch(e=>{console.error(e.message,e.cause?.code);process.exitCode=1})", url]],
   ["Node https", process.execPath, ["-e", "require('node:https').get(process.argv[1],r=>{r.pipe(process.stdout)}).on('error',e=>{console.error(e.message);process.exitCode=1})", url]],
   ["Python urllib", "python3", ["-c", "import urllib.request,ssl,sys; print(urllib.request.urlopen(sys.argv[1], context=ssl.create_default_context(cafile=sys.argv[2]), timeout=4).read().decode())", url, certPath]],
   ["Node http", process.execPath, ["-e", "require('node:http').get('http://allowed.fixture.test/',r=>r.pipe(process.stdout)).on('error',e=>{console.error(e.message);process.exitCode=1})"]],
  ];
  for (const [name, cmd, args] of cases) {
   const result = await run(cmd, args, env);
   assert.equal(result.code, 0, `${name}: ${result.err}`); assert.match(result.out, /fixture-ok/, name);
  }
  const codexCode = [
   `const {jiti}=await import(${JSON.stringify(new URL("./helpers.ts", import.meta.url).href)});`,
   `const {registerSandboxCodex}=await import(${JSON.stringify(new URL("../agent/extensions/runtime-health/network.ts", import.meta.url).href)});`,
   "const {openAICodexResponsesApi}=await jiti.import('@earendil-works/pi-ai/compat');",
   "let config;registerSandboxCodex({registerProvider:(_name,value)=>{config=value}},openAICodexResponsesApi(),{SANDBOX_RUNTIME:'1'});",
   "const token='fixture.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})).toString('base64url')+'.fixture';",
   "const model={id:'fixture',name:'fixture',provider:'openai-codex',api:'openai-codex-responses',baseUrl:process.argv[1].replace(/\\/$/,''),reasoning:false,input:['text'],contextWindow:300000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};",
   "const stream=config.streamSimple(model,{messages:[{role:'user',content:'fixture',timestamp:Date.now()}]},{apiKey:token,transport:'auto',headers:{'x-fixture':'preserve'},signal:AbortSignal.timeout(4000)});",
   "const message=await stream.result();if(message.stopReason==='error')throw Error(message.errorMessage);console.log('codex-sse-ok',message.usage.totalTokens);",
  ].join("\n");
  const codex = await run(process.execPath, ["--input-type=module", "-e", codexCode, url], env);
  assert.equal(codex.code, 0, codex.err); assert.match(codex.out, /codex-sse-ok 55/);
  assert.equal(codexRequests, 1, "actual Codex adapter must POST via the authenticated proxy with synthetic auth");
  const denied = await run("curl", ["-fsS", "--max-time", "4", "--cacert", certPath, url.replace("allowed.fixture.test", "denied.fixture.test")], env);
  assert.notEqual(denied.code, 0); assert.ok(seen.includes("denied.fixture.test"));
  const direct = await run(process.execPath, ["-e", "fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(()=>process.exitCode=1).catch(()=>console.log('proxy-dns-required'))", url], { ...env, NODE_USE_ENV_PROXY: "0" });
  // This fake hostname is resolvable only by the fixture proxy. This proves
  // client proxy dependency, not network-namespace enforcement/direct-IP denial.
  assert.equal(direct.code, 0); assert.match(direct.out, /proxy-dns-required/);
  const ws = await run(process.execPath, ["-e", "let done=false;const w=new WebSocket(process.argv[1]);let timer=setTimeout(()=>{console.error('timeout');process.exit(1)},3500);w.onmessage=e=>{done=true;clearTimeout(timer);console.log(e.data);w.close()};w.onerror=()=>{clearTimeout(timer);console.error('websocket-proxy-failed');process.exitCode=1}", url.replace("https:", "wss:")], env);
  t.diagnostic(`native WebSocket proxy result: ${ws.code === 0 ? "supported" : "not supported; use SSE for nested Pi"}`);
  // The selected automatic transport must have passed the authenticated TLS fixture.
  assert.equal(sandboxTransport("auto", { SANDBOX_RUNTIME: "1" }), "sse");
  // Native WebSocket support differs by Node version; never make it a prerequisite.
 } finally {
  for (const socket of sockets) socket.destroy();
  proxy.closeAllConnections(); target.closeAllConnections();
  await Promise.all([new Promise<void>(r => proxy.close(() => r())), new Promise<void>(r => target.close(() => r()))]);
  await rm(dir, { recursive: true, force: true });
 }
});
