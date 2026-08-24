import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AUTO_ZOOM_OPTION = "@pi_auto_zoom";

/**
 * Keep agent-managed tmux panes out of the user's way between turns.
 *
 * pi-tmux deliberately creates workers beside Pi. We leave that layout visible
 * while a command is being launched, then zoom Pi once the agent settles. The
 * pane option records that the zoom belongs to this extension so a user's own
 * manual zoom is never toggled accidentally and the state survives /reload.
 */
export default function tmuxAutoZoom(pi: ExtensionAPI) {
  const piPane = process.env.TMUX_PANE;
  if (!process.env.TMUX || !piPane || process.env.HERDR_ENV) return;

  async function getPaneOption(): Promise<boolean> {
    const result = await pi.exec("tmux", [
      "show-options",
      "-p",
      "-v",
      "-t",
      piPane,
      AUTO_ZOOM_OPTION,
    ]);
    return result.code === 0 && result.stdout.trim() === "1";
  }

  async function setPaneOption(enabled: boolean): Promise<void> {
    const args = enabled
      ? ["set-option", "-p", "-t", piPane, AUTO_ZOOM_OPTION, "1"]
      : ["set-option", "-p", "-u", "-t", piPane, AUTO_ZOOM_OPTION];
    await pi.exec("tmux", args);
  }

  async function isZoomed(): Promise<boolean> {
    const result = await pi.exec("tmux", [
      "display-message",
      "-p",
      "-t",
      piPane,
      "#{window_zoomed_flag}",
    ]);
    return result.code === 0 && result.stdout.trim() === "1";
  }

  async function hasManagedWorker(): Promise<boolean> {
    const result = await pi.exec("tmux", [
      "list-panes",
      "-t",
      piPane,
      "-F",
      "#{pane_id}\t#{@pi_name}",
    ]);
    if (result.code !== 0) return false;

    return result.stdout.split("\n").some((line) => {
      const [paneId, name] = line.split("\t");
      return paneId !== piPane && Boolean(name?.trim());
    });
  }

  async function revealWorkers(): Promise<void> {
    if (!(await getPaneOption())) return;
    if (await isZoomed()) {
      await pi.exec("tmux", ["resize-pane", "-Z", "-t", piPane]);
    }
    await setPaneOption(false);
  }

  async function focusPi(): Promise<void> {
    const managedWorkerExists = await hasManagedWorker();
    const extensionOwnsZoom = await getPaneOption();

    if (managedWorkerExists) {
      if (!(await isZoomed())) {
        await pi.exec("tmux", ["resize-pane", "-Z", "-t", piPane]);
        await setPaneOption(true);
      }
      return;
    }

    // Restore an unrelated user layout only when this extension caused zoom.
    if (extensionOwnsZoom) {
      if (await isZoomed()) {
        await pi.exec("tmux", ["resize-pane", "-Z", "-t", piPane]);
      }
      await setPaneOption(false);
    }
  }

  async function focusPiBestEffort(): Promise<void> {
    try {
      await focusPi();
    } catch {
      // Pane cleanup/focus is best effort and must never disrupt the agent.
    }
  }

  pi.on("session_start", focusPiBestEffort);

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "tmux") return;
    const input = event.input as { action?: string };
    if (input.action === "run") await revealWorkers();
  });

  pi.on("agent_settled", focusPiBestEffort);
}
