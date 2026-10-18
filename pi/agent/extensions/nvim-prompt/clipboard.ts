import { execFile } from "node:child_process";
import { lstat, readdir, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --cmd runs before init.lua/provider selection. Correct only the embedded
// child's environment, never the parent Pi/tmux session or ordinary Neovim.
export const neovimClipboardStartup = `
local uv = vim.uv or vim.loop
local runtime = vim.env.XDG_RUNTIME_DIR
if runtime and vim.fn.executable('wl-copy') == 1 and vim.fn.executable('wl-paste') == 1 then
  local function valid(display)
    if not display or display == '' then return false end
    local path = display:sub(1, 1) == '/' and display or runtime .. '/' .. display
    local info = uv.fs_stat(path)
    return info and info.type == 'socket' and info.uid == uv.getuid()
  end
  local display = vim.env.WAYLAND_DISPLAY
  if not valid(display) then
    local scan = uv.fs_scandir(runtime)
    local candidates = {}
    if scan then
      while true do
        local name = uv.fs_scandir_next(scan)
        if not name then break end
        if name:match('^wayland%-%d+$') and valid(name) then candidates[#candidates + 1] = name end
      end
    end
    table.sort(candidates)
    display = candidates[1]
  end
  if display then vim.env.WAYLAND_DISPLAY = display end
end
`.replace(/\n/g, ' ');

const imageTypes = new Map([
	["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/gif", "gif"],
]);
const textTypes = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"];
export type ClipboardValue = { kind: "image"; bytes: Buffer; extension: string } | { kind: "text"; text: string };
type Run = (args: string[], env: NodeJS.ProcessEnv) => Promise<Buffer>;

const runWlPaste: Run = (args, env) => new Promise((resolve, reject) => {
	execFile("wl-paste", args, { env, encoding: "buffer", timeout: 2000, maxBuffer: 50 * 1024 * 1024 },
		(error, stdout) => error ? reject(error) : resolve(stdout));
});

/** Read the current user's Wayland clipboard, even with a stale SSH/tmux environment. */
export async function readWaylandClipboard(options: { env?: NodeJS.ProcessEnv; run?: Run; displays?: string[] } = {}): Promise<ClipboardValue | undefined> {
	const env = options.env ?? process.env;
	const run = options.run ?? runWlPaste;
	let displays = options.displays;
	if (!displays) {
		displays = env.WAYLAND_DISPLAY ? [env.WAYLAND_DISPLAY] : [];
		if (env.XDG_RUNTIME_DIR) {
			try {
				for (const name of (await readdir(env.XDG_RUNTIME_DIR)).sort()) {
					if (!/^wayland-\d+$/.test(name) || displays.includes(name)) continue;
					const info = await lstat(join(env.XDG_RUNTIME_DIR, name));
					if (info.isSocket() && info.uid === process.getuid?.()) displays.push(name);
				}
			} catch { /* No local Wayland session; leave the X11 fallback available. */ }
		}
	}
	if (displays.length === 0) return undefined;
	for (const display of displays.slice(0, 3)) {
		const clipboardEnv = { ...env, WAYLAND_DISPLAY: display };
		let raw: Buffer;
		try { raw = await run(["--list-types"], clipboardEnv); }
		catch { continue; }
		const types = raw.toString("utf8").split(/\r?\n/).map((type) => type.trim()).filter(Boolean);
		const imageType = [...imageTypes.keys()].find((type) => types.includes(type));
		const textType = textTypes.find((type) => types.includes(type));
		const type = imageType ?? textType;
		if (!type) throw new Error("Clipboard has no supported image or text. Copy the image itself, not just its file icon.");
		const bytes = await run(["--no-newline", "--type", type], clipboardEnv);
		if (!bytes.length) throw new Error("Clipboard is empty.");
		return imageType
			? { kind: "image", bytes, extension: imageTypes.get(imageType)! }
			: { kind: "text", text: bytes.toString("utf8") };
	}
	throw new Error("Cannot connect to the Wayland clipboard. Check the desktop session and wl-paste installation.");
}

/** Use Wayland first; preserve X11 clipboard support on Linux without Wayland. */
export async function readLinuxClipboard(): Promise<ClipboardValue> {
	const wayland = await readWaylandClipboard();
	if (wayland) return wayland;
	if (!process.env.DISPLAY) throw new Error("No desktop clipboard is available in this session. SSH does not forward image clipboards automatically.");
	const run: Run = (args, env) => new Promise((resolve, reject) => {
		execFile("xclip", ["-selection", "clipboard", "-o", ...args],
			{ env, encoding: "buffer", timeout: 2000, maxBuffer: 50 * 1024 * 1024 },
			(error, stdout) => error ? reject(error) : resolve(stdout));
	});
	const types = (await run(["-t", "TARGETS"], process.env)).toString("utf8").split(/\r?\n/);
	const imageType = [...imageTypes.keys()].find((type) => types.includes(type));
	const textType = textTypes.find((type) => types.includes(type));
	const type = imageType ?? textType;
	if (!type) throw new Error("Clipboard has no supported image or text.");
	const bytes = await run(["-t", type], process.env);
	if (!bytes.length) throw new Error("Clipboard is empty.");
	return imageType ? { kind: "image", bytes, extension: imageTypes.get(imageType)! } : { kind: "text", text: bytes.toString("utf8") };
}

/** Preserve binary bytes and restrict screenshot file permissions. */
export async function saveClipboardImage(value: Extract<ClipboardValue, { kind: "image" }>, directory = tmpdir()): Promise<string> {
	await mkdir(directory, { recursive: true });
	const path = join(directory, `pi-clipboard-${randomUUID()}.${value.extension}`);
	await writeFile(path, value.bytes, { mode: 0o600, flag: "wx" });
	return path;
}
