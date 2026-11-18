/** "input_trust_level" -> "Input trust level" — several backend catalogs
 * (finding categories, control categories, evidence keys) are raw snake_case
 * identifiers with no fixed vocabulary, so this formats them without a
 * per-value i18n map. */
export function formatSnakeCase(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The items of a backend list worth showing, as strings. Generic-format
 * analyses copy properties verbatim, so blanks, nulls and nested objects are
 * dropped rather than rendered as "" or "[object Object]". */
export function listItems(value: unknown[]): string[] {
  return value
    .filter((v) => (typeof v === "string" && v !== "") || typeof v === "number" || typeof v === "boolean")
    .map(String);
}

/** A node property or finding evidence value as display text, so the same
 * value reads the same on the graph, in the results and in the export. */
export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return listItems(value).join(", ");
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
