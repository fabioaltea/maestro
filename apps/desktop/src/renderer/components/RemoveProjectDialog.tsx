import type { Desktop } from '../state/desktop.ts';
import type { Project } from '../state/project-view.ts';
import { useProjectAction } from '../state/project-actions.ts';
import { ConfirmationDialog } from './ConfirmationDialog.tsx';
export function RemoveProjectDialog({ desktop, project, live, onRemoved }: { desktop: Desktop; project: Project; live: boolean; onRemoved(id: string): Promise<void> }) {
  const action = useProjectAction(desktop, async () => { await onRemoved(project.projectId); });
  return <><button className="text-button danger" disabled={!live || action.busy} onClick={() => void action.prepare('project.remove', { projectId: project.projectId, expectedRevision: project.configRevision })}>Rimuovi dal registro</button>
    {action.last && action.last.outcome !== 'SUCCEEDED' && <p role="status" className="hint">{action.last.result === 'UNKNOWN_OUTCOME' ? 'Esito da verificare: consulta l’operazione originale.' : action.last.error?.message ?? 'Rimozione non completata.'}</p>}
    {action.prepared && <ConfirmationDialog prepared={action.prepared} busy={action.busy} onConfirm={() => void action.confirm()} onCancel={() => void action.cancel()} />}
  </>;
}
