export const settingSections = {
  workspaces: { label: 'Workspace', description: 'Checkout Git e branch dedicati alle feature.', scoped: true },
  environments: { label: 'Ambiente', description: 'Dipendenze, installazioni e verifiche del workspace.', scoped: true },
  sessions: { label: 'Sessioni', description: 'Avvio e controllo delle sessioni agente del repository.', scoped: true },
  queue: { label: 'Coda', description: 'Richieste in attesa e stato della pianificazione.', scoped: true },
  review: { label: 'Revisioni', description: 'Modifiche, verifiche e integrazione Git locale.', scoped: true },
  agents: { label: 'Agenti', description: 'Stato e output della Discovery del repository aperto.', scoped: false },
  profiles: { label: 'Profili agente', description: 'Configurazione di profili, skill e strumenti.', scoped: false },
  operations: { label: 'Operazioni', description: 'Ricevute ed esiti delle richieste inviate al servizio.', scoped: false },
  activity: { label: 'Attività', description: 'Cronologia degli eventi del servizio e dei repository.', scoped: false },
  diagnostics: { label: 'Diagnostica', description: 'Stato locale, account Codex e recupero dello storico.', scoped: false },
  service: { label: 'Servizio', description: 'Avvio, arresto e riavvio del servizio locale.', scoped: false },
} as const;

export type SettingSection = keyof typeof settingSections;

const groups: readonly { title: string; sections: readonly SettingSection[] }[] = [
  { title: 'Repository aperto', sections: ['workspaces', 'environments', 'sessions', 'queue', 'review'] },
  { title: 'Agenti e Discovery', sections: ['agents', 'profiles'] },
  { title: 'Sistema', sections: ['operations', 'activity', 'diagnostics', 'service'] },
];

export function Settings({ hasRepository, onOpen }: { hasRepository: boolean; onOpen(section: SettingSection): void }) {
  return <nav className="settings-grid" aria-label="Sezioni impostazioni">
    {groups.map(({ title, sections }, index) => <section key={title} className="settings-group" aria-labelledby={`settings-group-${index}`}>
      <h3 id={`settings-group-${index}`}>{title}</h3>
      {!hasRepository && index === 0 && <p className="hint">Apri un repository per usare queste schermate.</p>}
      <ul>
        {sections.map(id => {
          const { label, description, scoped } = settingSections[id];
          return <li key={id}><button className="settings-row" disabled={scoped && !hasRepository}
            aria-labelledby={`settings-label-${id}`} aria-describedby={`settings-description-${id}`} onClick={() => onOpen(id)}>
            <span>
              <strong id={`settings-label-${id}`}>{label}</strong>
              <small id={`settings-description-${id}`}>{description}</small>
            </span>
            <span className="settings-arrow" aria-hidden="true">›</span>
          </button></li>;
        })}
      </ul>
    </section>)}
  </nav>;
}
