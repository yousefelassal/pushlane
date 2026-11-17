/** Builds a CHECK expression from a closed set of domain values. */
export function oneOf(column: string, values: readonly string[]): string {
  return `"${column}" IN (${values.map((value) => `'${value}'`).join(', ')})`;
}

/** The first day of the current UTC month, the key for monthly plan allowances. */
export function currentMonth(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}
