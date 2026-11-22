export function dateLabel(value: unknown) {
  if (typeof value !== 'string') return 'Non disponibile';
  const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Non disponibile' : date.toLocaleString('it-IT');
}
export function flagLabel(value: unknown) { return value === true ? 'Sì' : value === false ? 'No' : 'Non verificato'; }
const baseStates: Record<string, string> = {
  UNCONFIGURED: 'Non configurata', VALID: 'Verificata nell’ultima osservazione',
  INVALID: 'Non valida nell’ultima osservazione', UNVERIFIED: 'Da verificare',
};
export function baseStateLabel(value: string) { return baseStates[value] ?? 'Non verificata'; }
