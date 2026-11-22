import { DashboardIcon, GearIcon, LayersIcon, MagnifyingGlassIcon, PersonIcon, CounterClockwiseClockIcon, CodeIcon } from '@radix-ui/react-icons';

const repositorySections = {
  overview: { label: 'Panoramica', Icon: DashboardIcon },
  history: { label: 'Storico Git', Icon: CounterClockwiseClockIcon },
  code: { label: 'Codice', Icon: CodeIcon },
  features: { label: 'Feature', Icon: LayersIcon },
  discovery: { label: 'Analizza codebase', Icon: MagnifyingGlassIcon },
  agents: { label: 'Agenti', Icon: PersonIcon },
  settings: { label: 'Impostazioni repository', Icon: GearIcon },
} as const;

export type RepositorySection = keyof typeof repositorySections;
export type DetailRoute =
  | { section: 'overview' }
  | { section: 'history' }
  | { section: 'code' }
  | { section: 'features'; featureId?: string; conversation?: boolean }
  | { section: 'discovery'; discoveryId?: string }
  | { section: 'agents'; discoveryId?: string };

export function RepositoryNavigation({ current, hasRepository, onOpen }: {
  current: RepositorySection | undefined;
  hasRepository: boolean;
  onOpen(section: RepositorySection): void;
}) {
  return <nav className="repository-rail" aria-label="Sezioni repository">
    {Object.entries(repositorySections).map(([id, item]) => {
      const section = id as RepositorySection;
      const disabled = !hasRepository && section !== 'overview';
      const label = !hasRepository && section === 'overview' ? 'Recenti' : item.label;
      return <button key={section} type="button" className={`repository-icon${section === 'settings' ? ' repository-settings-icon' : ''}`} aria-label={label}
        title={disabled ? `${label}: apri un repository` : label}
        aria-current={current === section ? 'page' : undefined} disabled={disabled}
        onClick={() => onOpen(section)}>
        <item.Icon width={22} height={22} aria-hidden="true" />
      </button>;
    })}
  </nav>;
}
