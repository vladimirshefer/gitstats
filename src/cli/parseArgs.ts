import path from 'path';

export type GroupBy = 'user' | 'repo' | 'lang';
export type ThenBy = 'repo' | 'lang' | 'date';

export type AggregatedData = Record<string, Record<string, number>>;

export interface CliArgs {
  targetPath: string;
  additionalRepoPaths: string[];
  outputFormat: 'csv' | 'html';
  htmlOutputFile?: string;
  filenameGlobs: string[];
  excludeGlobs: string[];
  groupBy: GroupBy;
  thenBy: ThenBy;
  dayBuckets: number[];
}

/**
 * Parse CLI arguments into strongly typed options.
 */
export function parseArgs(): CliArgs {
  const cliArgs = process.argv.slice(2);
  const result: Partial<CliArgs> = {
    filenameGlobs: [],
    excludeGlobs: [],
    outputFormat: 'csv',
    groupBy: 'user',
    thenBy: 'date',
    dayBuckets: [7, 30, 180, 365],
    additionalRepoPaths: [],
  };

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === '--html') {
      result.outputFormat = 'html';
      const nextArg = cliArgs[i + 1];
      if (nextArg && !nextArg.startsWith('-')) { result.htmlOutputFile = nextArg; i++; }
    } else if (arg === '--group-by') {
      const nextArg = cliArgs[i + 1] as GroupBy;
      if (nextArg && ['user', 'repo', 'lang'].includes(nextArg)) { result.groupBy = nextArg; i++; }
    } else if (arg === '--then-by') {
      const nextArg = cliArgs[i + 1] as ThenBy;
      if (nextArg && ['repo', 'lang', 'date'].includes(nextArg)) { result.thenBy = nextArg; i++; }
    } else if (arg.startsWith('--days=')) {
      const values = arg.split('=')[1];
      const parsed = values.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d > 0);
      if (parsed.length > 0) result.dayBuckets = parsed.sort((a, b) => a - b);
    } else if (arg === '--filename') {
      const nextArg = cliArgs[i + 1];
      if (nextArg && !nextArg.startsWith('-')) { result.filenameGlobs!.push(nextArg); i++; }
    } else if (arg === '--exclude-filename') {
      const nextArg = cliArgs[i + 1];
      if (nextArg && !nextArg.startsWith('-')) { result.excludeGlobs!.push(nextArg); i++; }
    } else if (arg === '--path') {
      const nextArg = cliArgs[i + 1];
      if (nextArg && !nextArg.startsWith('-')) { result.additionalRepoPaths!.push(nextArg); i++; }
    } else if (!arg.startsWith('-')) {
      if (!result.targetPath) result.targetPath = arg;
    }
  }

  result.targetPath = result.targetPath || '.';
  // Normalize targetPath for consistency (no trailing slash differences)
  result.targetPath = path.normalize(result.targetPath);
  return result as CliArgs;
}
