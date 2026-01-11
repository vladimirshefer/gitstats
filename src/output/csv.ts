/** CSV helpers */
export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Stage 4: Consume the stream and format as CSV.
 */
export async function streamToCsv<T extends Record<string, any>>(
    headers: Array<string>,
    statStream: AsyncIterable<T>
) {
  console.log(headers.map(h => csvEscape(h)).join(','));
  for await (const record of statStream) {
    console.log(
        headers.map(h => csvEscape(record[h] ?? "")).join(',')
    );
  }
}
