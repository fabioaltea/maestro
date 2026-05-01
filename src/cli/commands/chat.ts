import { TmuxSessionManager } from '../../tmux/session-manager.js';

export async function runChat(agent: string): Promise<void> {
  const tmux = new TmuxSessionManager();
  const sessionName = `agent-${agent}`;
  if (!tmux.has(sessionName)) {
    console.error(`[maestro] No active session for agent '${agent}'.`);
    process.exit(1);
  }
  tmux.attachOrSwitch(sessionName);
}
