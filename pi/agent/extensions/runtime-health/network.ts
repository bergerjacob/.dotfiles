import type { ProviderStreams, Transport } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Node clients otherwise ignore HTTP(S)_PROXY by default. Set this before
// spawning children, independent of pi-sandbox's startup/toggle path. This does
// not grant domains, remove namespaces, or replace a custom client agent.
export function configureNodeProxy(env: NodeJS.ProcessEnv = process.env, version = process.versions.node): boolean {
	const [major, minor] = version.split(".").map(Number);
	if (!((major === 22 && minor >= 21) || major >= 24) || env.NODE_USE_ENV_PROXY !== undefined) return false;
	env.NODE_USE_ENV_PROXY = "1";
	return true;
}

export function sandboxTransport(transport: Transport | undefined, env: NodeJS.ProcessEnv = process.env) {
	// Node's native WebSocket does not use this authenticated env proxy, while
	// fetch/SSE does. Keep explicit transport choices and host defaults intact.
	return env.SANDBOX_RUNTIME === "1" && (transport === undefined || transport === "auto") ? "sse" : transport;
}

export function registerSandboxCodex(pi: Pick<ExtensionAPI, "registerProvider">, codex: Pick<ProviderStreams, "streamSimple">, env: NodeJS.ProcessEnv = process.env): void {
	if (env.SANDBOX_RUNTIME !== "1") return;
	pi.registerProvider("openai-codex", {
		api: "openai-codex-responses",
		streamSimple: (model, context, options) => codex.streamSimple(model, context,
			{ ...options, transport: sandboxTransport(options?.transport, env) }),
	});
}

export function proxyHealth(env: NodeJS.ProcessEnv = process.env): string {
	// Proxy URLs can contain credentials. Report presence only, never values.
	return `HTTP(S) proxy: ${env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy ? "configured" : "unset"}; Node env proxy: ${env.NODE_USE_ENV_PROXY === "1" ? "enabled for future children" : "disabled/unset"}; sandbox child: ${env.SANDBOX_RUNTIME === "1" ? "yes" : "no"}`;
}
