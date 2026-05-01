import { execFileSync, spawnSync } from 'node:child_process';

export class TmuxSessionManager {
  static isAvailable(): boolean {
    const result = spawnSync('tmux', ['-V'], { stdio: 'pipe' });
    return result.status === 0 && result.error == null;
  }

  has(name: string): boolean {
    const result = spawnSync('tmux', ['has-session', '-t', name], { stdio: 'pipe' });
    return result.status === 0;
  }

  /**
   * Create a detached tmux session that runs argv.
   * Wraps the command in a shell so the pane stays alive after exit —
   * the user can read any error output before pressing Enter to close.
   */
  create(name: string, argv: string[]): void {
    // Shell-escape each argument (single-quote, escape any internal single-quotes)
    const escaped = argv.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const wrapper = `${escaped}; echo ""; echo "[maestro] Session ended (exit $?). Press Enter to close."; read _ignored`;
    execFileSync('tmux', ['new-session', '-d', '-s', name, 'bash', '-c', wrapper]);
  }

  kill(name: string): void {
    spawnSync('tmux', ['kill-session', '-t', name]);
  }

  attachOrSwitch(name: string): void {
    if (process.env['TMUX']) {
      execFileSync('tmux', ['switch-client', '-t', name], { stdio: 'inherit' });
    } else {
      execFileSync('tmux', ['attach-session', '-t', name], { stdio: 'inherit' });
    }
  }
}
