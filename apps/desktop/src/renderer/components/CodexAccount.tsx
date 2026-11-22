import type { CodexAccountStatus } from '../../shared/codex-contract.ts';
import type { Desktop } from '../state/desktop.ts';

const labels: Record<CodexAccountStatus['state'], string> = {
  CONNECTED: 'Account Codex collegato.',
  AUTH_REQUIRED: 'Collega Codex per analizzare il codice dei tuoi repository.',
  MISSING_CLI: 'Maestro non trova Codex CLI. Installa Codex e verifica di nuovo.',
  INCOMPATIBLE_CLI: 'La versione di Codex CLI installata non è compatibile con questa versione di Maestro.',
  UNAVAILABLE: 'Impossibile verificare il collegamento a Codex.',
  LOGIN_FAILED: 'Accesso a Codex non completato. Puoi riprovare.',
  CANCELLED: 'Accesso a Codex annullato.',
};

export function CodexAccount({ codex, diagnostics = false }: { codex: Desktop['codex']; diagnostics?: boolean }) {
  const { account, pending, refresh, login, cancel } = codex;
  if (!diagnostics && !pending && (!account || account.state === 'CONNECTED')) return null;
  const canLogin = account && ['AUTH_REQUIRED', 'LOGIN_FAILED', 'CANCELLED'].includes(account.state);
  return <section className="discovery-provider" aria-label="Account Codex">
    {diagnostics && <h4>Account Codex</h4>}
    <p role="status">{pending === 'login' ? 'Completa l’accesso nel browser aperto da Codex.'
      : pending === 'status' || !account ? 'Verifica dell’account Codex…' : labels[account.state]}</p>
    {diagnostics && account?.version && <p className="hint">Versione Codex CLI {account.version}</p>}
    {diagnostics && account?.binary && <p className="hint mono">{account.binary}</p>}
    {pending === 'login' ? <button className="button subtle" onClick={() => void cancel()}>Annulla accesso</button>
      : canLogin && !pending ? <button className="button primary" onClick={() => void login()}>Collega Codex</button>
        : !pending && <button className="button subtle" onClick={() => void refresh()}>Verifica account Codex</button>}
  </section>;
}
