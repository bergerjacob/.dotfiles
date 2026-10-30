// Plain JavaScript facade, not regex/AST rewriting: route the actual launch
// objects at runtime, including spreads, helpers and computed agent names.
export interface RoutePick { model: string; thinking?: string }
export interface RouteMode { primary: RoutePick; agents: Record<string, RoutePick | null> }

export function routeWorkflow(script: string, mode: RouteMode, aliases: Record<string, string>, name: string, explicitModel?: unknown): string {
	const bodyStart = "\n// pi-mode-body-start\n";
	const bodyEnd = "\n// pi-mode-body-end\n}\n";
	// A retry/replayed hook may receive its already-mutated input. Remove only
	// our exact envelope, then route afresh (including a changed active mode).
	if (script.startsWith("// pi-mode-routing-v1\n") && script.endsWith(bodyEnd)) {
		const start = script.indexOf(bodyStart);
		if (start >= 0) script = script.slice(start + bodyStart.length, -bodyEnd.length);
	}
	const picks = Object.fromEntries(Object.entries(mode.agents).map(([agent, pick]) => [agent,
		pick === null ? null : pick.thinking ? `${pick.model}:${pick.thinking}` : pick.model]));
	picks.main = mode.primary.thinking ? `${mode.primary.model}:${mode.primary.thinking}` : mode.primary.model;
	return `// pi-mode-routing-v1\nconst __piModeNativeRuns = runs;\n{
const __piModePicks = ${JSON.stringify(picks)};
const __piModeAliases = ${JSON.stringify(aliases)};
function __piModeRoute(params) {
  if (!params || typeof params !== "object" || params.resume) return params;
  const raw = typeof params.agent === "string" ? params.agent.toLowerCase() : "main";
  const canonical = Object.hasOwn(__piModeAliases, raw) ? __piModeAliases[raw] : raw;
  const pick = Object.hasOwn(__piModePicks, canonical) ? __piModePicks[canonical] : undefined;
  if (pick === null) throw new Error('agent "' + canonical + '" is disabled in mode ' + ${JSON.stringify(name)});
  if (params.model || ${JSON.stringify(Boolean(explicitModel))} || !pick) return params;
  return { ...params, model: pick };
}
const runs = {
  ...__piModeNativeRuns,
  run(key, params) { return __piModeNativeRuns.run(key, __piModeRoute(params)); },
  all(items) {
    return __piModeNativeRuns.all(Array.isArray(items) ? items.map(__piModeRoute) : items).then(function(results) {
      if (results.length > 0 && results.every(function(result) { return result.ok === false; })) {
        throw new Error('All workflow children failed: ' + results.slice(0, 12).map(function(result) { return result.key; }).join(', ') + '. Inspect child errors before starting dependent work.');
      }
      return results;
    });
  }
};
// pi-mode-body-start
${script}
// pi-mode-body-end
}\n`;
}

export function filterAgentList(text: string, mode: RouteMode, aliases: Record<string, string>, name: string): string {
	if (!text.includes("Executable agents:")) return text;
	const disabled: string[] = [];
	const lines = text.split("\n").filter((line) => {
		const match = /^- ([\w.-]+) \(/.exec(line);
		if (!match) return true;
		const canonical = aliases[match[1].toLowerCase()] ?? match[1].toLowerCase();
		if (mode.agents[canonical] !== null) return true;
		disabled.push(line);
		return false;
	});
	if (disabled.length) lines.push(`\nDisabled in mode ${name} (not executable):`, ...disabled);
	return lines.join("\n");
}
