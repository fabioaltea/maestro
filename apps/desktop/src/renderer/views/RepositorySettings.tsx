export const repositorySettings = {
  general: 'Generali',
  workspaces: 'Workspace',
  environments: 'Ambiente',
  sessions: 'Sessioni',
  queue: 'Coda',
  review: 'Revisioni',
} as const;

export type RepositorySetting = keyof typeof repositorySettings;

export function isRepositorySetting(value: string): value is RepositorySetting {
  return Object.hasOwn(repositorySettings, value);
}

export function RepositorySettings({ current, onOpen }: {
  current?: RepositorySetting;
  onOpen(setting: RepositorySetting): void;
}) {
  return <header className="repository-settings-header">
    <h2>Impostazioni repository</h2>
    <nav className="repository-settings-nav" aria-label="Impostazioni repository">
      {Object.entries(repositorySettings).map(([key, label]) => {
        const setting = key as RepositorySetting;
        return <button key={setting} type="button" className="button subtle"
          aria-current={current === setting ? 'page' : undefined}
          onClick={() => onOpen(setting)}>{label}</button>;
      })}
    </nav>
    {current && <h3>{repositorySettings[current]}</h3>}
  </header>;
}
