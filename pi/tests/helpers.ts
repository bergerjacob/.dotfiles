import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const globalModules = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
export const requirePi = createRequire(join(globalModules, "@earendil-works/pi-coding-agent/package.json"));
const { createJiti } = requirePi("jiti");
export const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-ai/compat": join(globalModules, "@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/compat.js"), typebox: join(globalModules, "@earendil-works/pi-coding-agent/node_modules/typebox/build/index.mjs"), ...Object.fromEntries(
	["pi-ai", "pi-coding-agent", "pi-tui"].map((name) => {
		const full = `@earendil-works/${name}`;
		return [full, name === "pi-coding-agent"
			? join(globalModules, full, "dist/index.js")
			: join(globalModules, "@earendil-works/pi-coding-agent/node_modules", full, "dist/index.js")];
	}),
) } });
