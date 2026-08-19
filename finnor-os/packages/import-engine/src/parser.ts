export interface ParsedSourceRow {
  rowNumber: number;
  value?: Record<string, unknown>;
  error?: string;
}

function csvRecords(content: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); records.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); records.push(row); }
  return records;
}

export function parseSource(content: string, format: "csv" | "json" | "jsonl", delimiter = ","): ParsedSourceRow[] {
  if (format === "csv") {
    const records = csvRecords(content.replace(/^\uFEFF/, ""), delimiter);
    const headers = records.shift()?.map((header) => header.trim()) ?? [];
    if (!headers.length || headers.some((header) => !header)) throw new Error("CSV requires a non-empty header row");
    if (new Set(headers).size !== headers.length) throw new Error("CSV header names must be unique");
    return records.filter((row) => row.some((value) => value !== "")).map((row, index) => {
      if (row.length !== headers.length) return { rowNumber: index + 2, error: `CSV row has ${row.length} columns; expected ${headers.length}` };
      return { rowNumber: index + 2, value: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])) };
    });
  }
  if (format === "json") {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON import source must be an array of objects");
    return parsed.map((value, index) => value && typeof value === "object" && !Array.isArray(value)
      ? { rowNumber: index + 1, value: value as Record<string, unknown> }
      : { rowNumber: index + 1, error: "JSON row must be an object" });
  }
  return content.split(/\r?\n/).map((line, index) => ({ line, rowNumber: index + 1 })).filter(({ line }) => line.trim()).map(({ line, rowNumber }) => {
    try {
      const value = JSON.parse(line) as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? { rowNumber, value: value as Record<string, unknown> }
        : { rowNumber, error: "JSONL row must be an object" };
    } catch (error) {
      return { rowNumber, error: `invalid JSON: ${(error as Error).message}` };
    }
  });
}
