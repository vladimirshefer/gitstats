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

import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {generateHtmlReport} from './output/report_template';
import {RawLineStat} from "./base/RawLineStat";
import {isGitRepo} from "./base/utils";
import {csvEscape} from './output/csv';
import {parseArgs, AggregatedData, CliArgs} from './cli/parseArgs';

// --- General Types ---
let sigintCaught = false;

// Types moved to src/cli/parseArgs.ts

// --- Utility Functions ---

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
    for (const repoPath of repoPaths) {
        if (sigintCaught) break;
        console.error(`\nProcessing repository: ${repoPath || '.'}`);

        const originalCwd = process.cwd();
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
        
            // Stage 1: File Discovery
            const finalTargetPath = path.relative(repoRoot, discoveryPath);
            const includePathspecs = (args.filenameGlobs && args.filenameGlobs.length > 0) ? args.filenameGlobs.map(g => `'${g}'`).join(' ') : '';
            const excludePathspecs = (args.excludeGlobs && args.excludeGlobs.length > 0) ? args.excludeGlobs.map(g => `':!${g}'`).join(' ') : '';
            const filesCommand = `git ls-files -- "${finalTargetPath || '.'}" ${includePathspecs} ${excludePathspecs}`;
            const filesOutput = execSync(filesCommand, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 50 }).toString().trim();
            const files = filesOutput ? filesOutput.split('\n') : [];

            console.error(`Found ${files.length} files to analyze in '${repoName}'...`);

            // Stage 2: Raw Data Extraction (Streaming)
            for (let i = 0; i < files.length; i++) {
                if (sigintCaught) break;
                const file = files[i];
                const progressMessage = `[${i + 1}/${files.length}] Analyzing: ${file}`;
                process.stderr.write(progressMessage.padEnd(process.stderr.columns || 80, ' ') + '\r');
                
                if (!file) continue;
                const absPath = path.join(repoRoot, file);
                let stat: fs.Stats | null = null;
                try { stat = fs.statSync(absPath); } catch { stat = null; }
                if (!stat || !stat.isFile() || stat.size === 0) continue;
                
                try {
                    yield* extractRawStatsForFile(file, repoName, repoRoot);
                } catch (e: any) {
                    if (e.signal === 'SIGINT') sigintCaught = true;
                    // Silently skip files that error
                }
            }
            process.stderr.write(' '.repeat(process.stderr.columns || 80) + '\r');
            console.error(`Analysis complete for '${repoName}'.`);
    }
}

function* extractRawStatsForFile(file: string, repoName: string, repoRoot: string): Generator<RawLineStat> {
    const blameOutput = execSync(`git blame --line-porcelain -- "${file}"`, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 50 }).toString();
    const blameLines = blameOutput.trim().split('\n');
    const lang = path.extname(file) || 'Other';
    
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
    const { groupBy, thenBy, dayBuckets }: CliArgs = args;
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
        const primaryKey: string = item[groupBy];
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
        console.log([
            csvEscape(record.repoName),
            csvEscape(record.filePath),
            csvEscape(record.lang),
            csvEscape(record.user),
            csvEscape(record.time),
        ].join(','));
    }
}

// --- Argument Parsing ---
// parseArgs moved to src/cli/parseArgs.ts

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
