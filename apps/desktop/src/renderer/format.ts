export function dateLabel(value: unknown) {
  if (typeof value !== 'string') return 'Non disponibile';
  const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Non disponibile' : date.toLocaleString('it-IT');
}
export function flagLabel(value: unknown) { return value === true ? 'Sì' : value === false ? 'No' : 'Non verificato'; }
