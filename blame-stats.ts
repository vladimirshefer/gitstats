/**
 * Git Blame Statistics Analyzer (Streaming Refactor)
 *
 * This script analyzes Git repository blame information using a memory-efficient
 * streaming data pipeline to generate statistics on code authorship.
 *
 * --- Pipeline Stages ---
 * 1.  **File Discovery:** Locates all relevant files.
 * 2.  **Raw Data Extraction:** Streams `git blame` output line-by-line.
 * 3.  **Aggregation:** Consumes the stream to group stats based on configurable dimensions.
 * 4.  **Output Formatting:** Renders the aggregated data as an HTML report or a CSV file.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { generateHtmlReport } from './report-template'; 

// --- General Types ---
let sigintCaught = false;

// --- Stage 2: Raw Data Extraction Types ---
interface RawLineStat {
    repoName: string;
    filePath: string;
    lang: string;
    user: string;
    time: number; // Unix timestamp
}

// --- Stage 3: Aggregation Types ---
type PrimaryGrouping = 'user' | 'repo' | 'lang';
type SecondaryGrouping = 'repo' | 'lang' | 'date';
export interface AggregatedData {
    [primaryKey: string]: {
        [secondaryKey: string]: number;
    };
}

// --- CLI Argument Types ---
interface CliArgs {
    targetPath: string;
    additionalRepoPaths: string[];
    outputFormat: 'csv' | 'html';
    htmlOutputFile?: string;
    filenameGlobs?: string[];
    excludeGlobs?: string[];
    groupBy: PrimaryGrouping;
    thenBy: SecondaryGrouping;
    dayBuckets: number[];
}

// --- Utility Functions ---

function getLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    const langMap: { [key: string]: string } = {
        '.kt': 'Kotlin', '.kts': 'Kotlin Script',
        '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
        '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
        '.java': 'Java',
        '.go': 'Go',
        '.py': 'Python',
        '.rb': 'Ruby',
        '.rs': 'Rust',
        '.cs': 'C#',
        '.php': 'PHP',
        '.cpp': 'C++', '.cxx': 'C++', '.cc': 'C++',
        '.h': 'C/C++ Header', '.hpp': 'C++ Header',
        '.c': 'C',
        '.sql': 'SQL',
        '.sh': 'Shell',
        '.html': 'HTML',
        '.css': 'CSS',
        '.json': 'JSON',
        '.xml': 'XML',
        '.yml': 'YAML', '.yaml': 'YAML',
        '.md': 'Markdown',
    };
    return langMap[extension] || path.extname(filePath) || 'Other';
}

function isGitRepo(dir: string): boolean {
    return fs.existsSync(path.join(dir, '.git'));
}

function getDirectories(source: string): string[] {
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return [];
    const ignoredDirs = new Set(['.git', 'node_modules']);
    try {
        return fs.readdirSync(source, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && !ignoredDirs.has(dirent.name))
            .map(dirent => path.join(source, dirent.name));
    } catch (error) {
        console.error(`Could not read directory: ${source}`);
        return [];
    }
}

// --- Pipeline Stage Implementations ---

/**
 * Stage 1 & 2 combined: Discover files and stream raw blame statistics.
 * This is the main generator function for the pipeline.
 */
async function* discoverAndExtract(repoPaths: string[], args: CliArgs): AsyncGenerator<RawLineStat> {
    const originalCwd = process.cwd();

    for (const repoPath of repoPaths) {
        if (sigintCaught) break;
        console.error(`\nProcessing repository: ${repoPath || '.'}`);

        const discoveryPath = path.resolve(originalCwd, repoPath);
        if (!fs.existsSync(discoveryPath)) {
            console.error(`Error: Path does not exist: ${discoveryPath}. Skipping.`);
            continue;
        }

        const gitCommandPath = fs.statSync(discoveryPath).isDirectory() ? discoveryPath : path.dirname(discoveryPath);

        let repoRoot: string;
        try {
            repoRoot = execSync('git rev-parse --show-toplevel', { cwd: gitCommandPath, stdio: 'pipe' }).toString().trim();
        } catch (e) {
            console.error(`Error: Could not find git repository at ${gitCommandPath}. Skipping.`);
            continue;
        }
        
        const repoName = path.basename(repoRoot);
        process.chdir(repoRoot);

        try {
            // Stage 1: File Discovery
            const finalTargetPath = path.relative(repoRoot, discoveryPath);
            const includePathspecs = (args.filenameGlobs && args.filenameGlobs.length > 0) ? args.filenameGlobs.map(g => `'${g}'`).join(' ') : '';
            const excludePathspecs = (args.excludeGlobs && args.excludeGlobs.length > 0) ? args.excludeGlobs.map(g => `':!${g}'`).join(' ') : '';
            const filesCommand = `git ls-files -- "${finalTargetPath || '.'}" ${includePathspecs} ${excludePathspecs}`;
            const filesOutput = execSync(filesCommand, { maxBuffer: 1024 * 1024 * 50 }).toString().trim();
            const files = filesOutput ? filesOutput.split('\n') : [];

            console.error(`Found ${files.length} files to analyze in '${repoName}'...`);

            // Stage 2: Raw Data Extraction (Streaming)
            for (let i = 0; i < files.length; i++) {
                if (sigintCaught) break;
                const file = files[i];
                const progressMessage = `[${i + 1}/${files.length}] Analyzing: ${file}`;
                process.stderr.write(progressMessage.padEnd(process.stderr.columns || 80, ' ') + '\r');
                
                if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
                    continue;
                }
                
                try {
                    yield* extractRawStatsForFile(file, repoName);
                } catch (e: any) {
                    if (e.signal === 'SIGINT') sigintCaught = true;
                    // Silently skip files that error
                }
            }
            process.stderr.write(' '.repeat(process.stderr.columns || 80) + '\r');
            console.error(`Analysis complete for '${repoName}'.`);

        } finally {
            process.chdir(originalCwd);
        }
    }
}

function* extractRawStatsForFile(file: string, repoName: string): Generator<RawLineStat> {
    const blameOutput = execSync(`git blame --line-porcelain -- "${file}"`, { maxBuffer: 1024 * 1024 * 50 }).toString();
    const blameLines = blameOutput.trim().split('\n');
    const lang = getLanguage(file);
    
    let currentUser = '', currentTime = 0;

    for (const line of blameLines) {
        if (line.startsWith('author ')) {
            currentUser = line.substring('author '.length).replace(/^<|>$/g, '');
        } else if (line.startsWith('committer-time ')) {
            currentTime = parseInt(line.substring('committer-time '.length), 10);
        } else if (line.startsWith('\t') && currentUser && currentTime) {
            yield { repoName, filePath: file, lang, user: currentUser, time: currentTime };
        }
    }
}

/**
 * Stage 3: Aggregate raw stats from the stream based on grouping dimensions.
 */
async function aggregateRawStats(statStream: AsyncGenerator<RawLineStat>, args: CliArgs): Promise<AggregatedData> {
    const { groupBy, thenBy, dayBuckets } = args;
    const stats: AggregatedData = {};
    const now = Date.now() / 1000;

    const getSecondaryKey = (item: RawLineStat): string => {
        switch (thenBy) {
            case 'repo': return item.repoName;
            case 'lang': return item.lang;
            case 'date':
                const ageInDays = (now - item.time) / (60 * 60 * 24);
                for (const d of dayBuckets) {
                    if (ageInDays <= d) return `Last ${d} days`;
                }
                return 'Older';
        }
    };
    
    for await (const item of statStream) {
        const primaryKey = item[groupBy];
        const secondaryKey = getSecondaryKey(item);

        if (!stats[primaryKey]) stats[primaryKey] = {};
        if (!stats[primaryKey][secondaryKey]) stats[primaryKey][secondaryKey] = 0;

        stats[primaryKey][secondaryKey]++;
    }
    return stats;
}

/**
 * Stage 4: Consume the stream and format as CSV.
 */
async function streamToCsv(statStream: AsyncGenerator<RawLineStat>) {
    console.log('repository_name,file_path,language,username,commit_timestamp');
    for await (const record of statStream) {
        if (sigintCaught) break;
        console.log(`${record.repoName},"${record.filePath}",${record.lang},${record.user},${record.time}`);
    }
}

// --- Argument Parsing ---
function parseArgs(): CliArgs {
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
            const nextArg = cliArgs[i + 1] as PrimaryGrouping;
            if (nextArg && ['user', 'repo', 'lang'].includes(nextArg)) { result.groupBy = nextArg; i++; }
        } else if (arg === '--then-by') {
            const nextArg = cliArgs[i + 1] as SecondaryGrouping;
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
    return result as CliArgs;
}

// --- Main Application Controller ---
async function main() {
    process.on('SIGINT', () => {
        if (sigintCaught) { console.error("\nForcing exit."); process.exit(130); }
        sigintCaught = true;
        console.error("\nSignal received. Finishing current file then stopping. Press Ctrl+C again to exit immediately.");
    });

    const args = parseArgs();
    const originalCwd = process.cwd();
    let repoPathsToProcess: string[] = [...args.additionalRepoPaths];

    // --- Repo Discovery ---
    const targetFullPath = path.resolve(originalCwd, args.targetPath);
    if (!fs.existsSync(targetFullPath)) {
        console.error(`Error: Path does not exist: ${targetFullPath}`);
        process.exit(1);
    }
    if (isGitRepo(targetFullPath)) {
        repoPathsToProcess.push(args.targetPath);
    } else if (fs.statSync(targetFullPath).isDirectory()) {
        console.error(`'${args.targetPath}' is not a git repository. Searching for git repositories within...`);
        const foundRepos = getDirectories(targetFullPath)
            .flatMap(dir => isGitRepo(dir) ? [dir] : getDirectories(dir).filter(isGitRepo))
            .map(repoPath => path.relative(originalCwd, repoPath));
        repoPathsToProcess.push(...foundRepos);
    }
    repoPathsToProcess = [...new Set(repoPathsToProcess)].sort();

    if (repoPathsToProcess.length === 0) {
        console.error("No git repositories found to analyze.");
        process.exit(0);
    }
    
    console.error(`Found ${repoPathsToProcess.length} repositories to analyze:`);
    repoPathsToProcess.forEach(p => console.error(`- ${p || '.'}`));

    // --- Pipeline Execution ---
    const statStream = discoverAndExtract(repoPathsToProcess, args);

    if (args.outputFormat === 'html') {
        const aggregatedData = await aggregateRawStats(statStream, args); // Stage 3
        if (sigintCaught) console.error("\nAnalysis was interrupted. HTML report may be incomplete.");

        // Stage 4 for HTML
        const htmlFile = args.htmlOutputFile || 'git-blame-stats-report.html';
        generateHtmlReport(aggregatedData, htmlFile, originalCwd, args);
        console.log(`\nHTML report generated: ${path.resolve(originalCwd, htmlFile)}`);
    } else {
        await streamToCsv(statStream); // Stage 4 for CSV
        if (sigintCaught) console.error("\nAnalysis was interrupted. CSV output may be incomplete.");
    }
}

// --- Entry Point ---
main().catch(console.error);
