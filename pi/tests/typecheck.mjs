// Optional strict check against the installed Pi API; requires tsc on PATH.
// Uses a temporary config, never creates node_modules or edits dependencies.
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const globalModules = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const pi = process.env.PI_PACKAGE_DIR || join(globalModules, "@earendil-works/pi-coding-agent");
const files = ["modes.ts", "mode-routing/workflow.ts", "tmux-panes.ts", "tmux-auto-zoom.ts", "secret-mask.ts", "runtime-health.ts", "runtime-health/desktop.ts", "dcp/index.ts", "dcp/core.ts"];
const dir = await mkdtemp(join(tmpdir(), "dotfiles-pi-types-"));
try {
  const config = join(dir, "tsconfig.json");
  await writeFile(config, JSON.stringify({
    compilerOptions: {
      target: "ES2023", module: "ESNext", moduleResolution: "bundler", allowImportingTsExtensions: true,
      noEmit: true, strict: true, skipLibCheck: true,
      paths: { typebox: [join(pi, "node_modules/typebox/build/index.d.mts")], ...Object.fromEntries(["pi-coding-agent", "pi-ai", "pi-tui"].map((name) => [
        `@earendil-works/${name}`, [name === "pi-coding-agent" ? join(pi, "dist/index.d.ts") : join(pi, "node_modules/@earendil-works", name, "dist/index.d.ts")],
      ])) },
      typeRoots: [join(pi, "node_modules/@types")],
    },
    files: files.map((file) => fileURLToPath(new URL(`../agent/extensions/${file}`, import.meta.url))),
  }));
  execFileSync("tsc", ["-p", config], { stdio: "inherit" });
} catch (error) {
  if (!error.status) console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
