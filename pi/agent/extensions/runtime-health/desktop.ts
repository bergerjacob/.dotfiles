import { readdir, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Repair only a missing/stale Wayland display, never guess among desktops. */
export async function refreshWayland(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
	const runtime = env.XDG_RUNTIME_DIR;
	if (!runtime || process.platform !== "linux") return;
	const valid = async (display: string) => {
		try {
			const stat = await lstat(isAbsolute(display) ? display : join(runtime, display));
			return stat.isSocket() && stat.uid === process.getuid?.();
		} catch { return false; }
	};
	if (env.WAYLAND_DISPLAY && await valid(env.WAYLAND_DISPLAY)) return;
	try {
		const candidates: string[] = [];
		for (const name of await readdir(runtime)) if (/^wayland-\d+$/.test(name) && await valid(name)) candidates.push(name);
		if (candidates.length !== 1) return;
		env.WAYLAND_DISPLAY = candidates[0];
		return candidates[0];
	} catch { return; }
}
