const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = /^(0|[1-9][0-9]*)$/;
const sqliteMaxInteger = 9_223_372_036_854_775_807n;

export function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('INVALID_IDENTIFIER');
  return value.toLowerCase();
}

export function requireDecimal(value: unknown): string {
  if (typeof value !== 'string' || value.length > 19 || !decimal.test(value)
    || BigInt(value) > sqliteMaxInteger) throw new Error('INVALID_IDENTIFIER');
  return value;
}
