const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are user input; reject non-UUIDs before Postgres does it with an error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
