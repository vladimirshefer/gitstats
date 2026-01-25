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
import {findRevision, git_blame_porcelain, git_ls_files, isGitRepo} from "./git";
import {RealFileSystemImpl, VirtualFileSystem} from "./vfs";
import {AsyncGeneratorUtil, AsyncIteratorWrapperImpl} from "./util/AsyncGeneratorUtil";
import {clusterFiles} from "./util/file_tree_clustering";
import {DataRow} from "./base/types";
import {distinctCount} from "./util/dataset";

let sigintCaught = false;

function getDirectories(source: string): string[] {
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return [];
    const ignoredDirs = new Set(['.git', 'node_modules']);
    try {
        return fs.readdirSync(source, {withFileTypes: true})
            .filter(dirent => dirent.isDirectory() && !ignoredDirs.has(dirent.name))
            .map(dirent => path.join(source, dirent.name));
    } catch (error) {
        console.error(`Could not read directory: ${source}`);
        return [];
    }
}

async function* forEachRepoFile(
    repoPath: string,
    doProcessFile: (repoRoot: string, fileName: string, revisionBoundary: string | undefined) => Promise<DataRow[]>
): AsyncGenerator<DataRow> {
    console.error(`\nProcessing repository: ${repoPath || '.'}`);

    const originalCwd = process.cwd();
    const discoveryPath = path.resolve(originalCwd, repoPath);
    if (!fs.existsSync(discoveryPath)) {
        console.error(`Error: Path does not exist: ${discoveryPath}. Skipping.`);
        return;
    }

    const gitCommandPath = fs.statSync(discoveryPath).isDirectory() ? discoveryPath : path.dirname(discoveryPath);

    let repoRoot: string;
    try {
        repoRoot = execSync('git rev-parse --show-toplevel', {cwd: gitCommandPath, stdio: 'pipe'}).toString().trim();
    } catch (e) {
        console.error(`Error: Could not find git repository at ${gitCommandPath}. Skipping.`);
        return;
    }

    const repoName = path.basename(repoRoot);

    let revisionBoundary = await findRevision(repoRoot, 1000);

    const files = await git_ls_files(repoRoot, path.relative(repoRoot, discoveryPath));
    let minClusterSize = Math.floor(Math.max(5, files.length / 1000));
    let maxClusterSize = Math.round(Math.max(20, minClusterSize*2));
    console.error(`Clustering ${files.length} into ${minClusterSize}..${maxClusterSize}+ sized chunks`);
    const filesClustered = clusterFiles(
        files,
        maxClusterSize,
        minClusterSize
    );
    console.error(filesClustered.map(it => `${it.path}${it.isLeftovers ? "/*" : ""} (${it.weight})`));
    let clusterPaths = filesClustered.map(it => it.path);

    console.error(`Found ${files.length} files to analyze in '${repoName}'...`);

    let filesShuffled = [...files].sort(() => Math.random() - 0.5);

    for (let i = 0; i < files.length; i++) {
        if (sigintCaught) break;
        const file = filesShuffled[i];
        const progressMessage = `[${i + 1}/${files.length}] Analyzing: ${file}`;
        process.stderr.write(progressMessage.padEnd(process.stderr.columns || 80, ' ') + '\r');

        try {
            let clusterPath = clusterPaths.find(it => file.startsWith(it)) ?? "$$$unknown$$$";
            yield* (await doProcessFile(repoRoot, file, revisionBoundary)).map(it => it.concat(clusterPath) as DataRow);
        } catch (e: any) {
            if (e.signal === 'SIGINT') sigintCaught = true;
            // Silently skip files that error
        }
    }

    process.stderr.write(' '.repeat(process.stderr.columns || 80) + '\r');
    console.error(`Analysis complete for '${repoName}'.`);
}

function daysAgo(epoch: number): number {
    const now = Date.now();
    const diff = now - (epoch * 1000);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function bucket(n: number, buckets: number[]): number {
    for (let i = 1; i < buckets.length; i++) {
        if (n > buckets[i-1] && n < buckets[i]) return buckets[i - 1];
    }
    return -1;
}

async function doProcessFile1(repoRoot: string, filePath: string, revisionBoundary?: string): Promise<DataRow[]> {
    if (!filePath) return [];
    const absPath = path.join(repoRoot, filePath);
    let stat: fs.Stats | null = null;
    try {
        stat = fs.statSync(absPath);
    } catch(e: any) {
        console.error(`Fail get stats for file ${absPath}`, e.stack || e.message || e);
    }
    if (!stat || !stat.isFile() || stat.size === 0) return [];

    const result: DataRow[] = []
    for (const item of await git_blame_porcelain(filePath, repoRoot, ["author", "committer-time", "commit"], revisionBoundary + "..HEAD")) {
        if (revisionBoundary === item[2]) {
            item[0] = "?"
            item[1] = 0
            item[2] = "0".repeat(40)
        }
        const lang = path.extname(filePath) || 'Other';
        let days_bucket = bucket(daysAgo(item[1] as number), [0, 30, 300, 1000, 1000000]);
        if (days_bucket != -1) {
            result.push([item[0], days_bucket, lang, filePath, repoRoot]);
        }
    }
    return result;
}

function distinct<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

function getRepoPathsToProcess(inputPaths: string[]): string[] {
    let repoPathsToProcess: string[] = inputPaths.flatMap(it => findRepositories(it, 3));
    repoPathsToProcess = distinct(repoPathsToProcess).sort();
    if (repoPathsToProcess.length === 0) {
        throw new Error("No git repositories found to analyze.");
    }

    console.error(`Found ${repoPathsToProcess.length} repositories to analyze:`);
    repoPathsToProcess.forEach(p => console.error(`- ${p || '.'}`));
    return repoPathsToProcess;
}

async function runScan(args: string[]) {
    const tmpVfs: VirtualFileSystem = new RealFileSystemImpl("./.git-stats/");

    process.on('SIGINT', () => {
        if (sigintCaught) {
            console.error("\nForcing exit.");
            process.exit(130);
        }
        sigintCaught = true;
        console.error("\nSignal received. Finishing current file then stopping. Press Ctrl+C again to exit immediately.");
    });

    const inputPaths = (args && args.length > 0) ? args : ['.'];
    let repoPathsToProcess = getRepoPathsToProcess(inputPaths);

    await tmpVfs.write("data.jsonl", "");

    let dataSet = new AsyncIteratorWrapperImpl(AsyncGeneratorUtil.of(repoPathsToProcess))
        .flatMap(repoPath => forEachRepoFile(repoPath, doProcessFile1))
        .map(it => [it[0], it[1], it[2], it[5], path.basename(it[4] as string)])
        .get();

    let aggregatedData1 = distinctCount(dataSet);
    let aggregatedData = await AsyncGeneratorUtil.collect(aggregatedData1);

    // Keep current behavior: write aggregated data into .git-stats/data.jsonl
    aggregatedData.forEach(it => console.log(JSON.stringify(it)));
}

async function runHtml(args: string[]) {
    const inputPath = args[0] || path.resolve('./.git-stats/data.jsonl');
    const outHtml = path.resolve('./.git-stats/report.html');

    if (!fs.existsSync(inputPath)) {
        console.error(`Input data file not found: ${inputPath}`);
        process.exitCode = 1;
        return;
    }

    const lines = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const aggregatedData = lines.map(line => {
        try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean) as DataRow[];

    generateHtmlReport(aggregatedData, outHtml);
    console.error(`HTML report generated: ${outHtml}`);
}

function findRepositories(path: string, depth: number): string[] {
    if (depth <= 0) return [];
    if (!fs.existsSync(path)) throw new Error(`Path does not exist: ${path}`);
    if (!fs.statSync(path).isDirectory()) return [];
    if (isGitRepo(path)) return [path];
    let result = getDirectories(path).flatMap(dir => findRepositories(dir, depth - 1));
    return distinct(result).sort();
}

// --- Main Application Controller ---
async function main() {
    const argv = process.argv.slice(2);
    let subcommand = argv[0];

    let subcommandsMenu = {
        "html": {
            description: "Generates an HTML report from the aggregated data.",
            usage: "git-stats html [input-data-file]"
        },
        "scan": {
            description: "Scans a directory tree for Git repositories and generates aggregated data.",
            usage: "git-stats scan [input-dir] > {output-file}.jsonl"
        }
    }

    if (subcommand === 'scan') {
        await runScan(argv.slice(1));
        return;
    }

    if (subcommand === 'html') {
        await runHtml(argv.slice(1));
        return;
    }

    console.error(`Usage: git-stats <subcommand> [args]\n\nAvailable subcommands:`);
    for (const [name, {description, usage}] of Object.entries(subcommandsMenu)) {
        console.error(`- ${name}: ${description}\n    Usage: ${usage}`);
    }
}

// --- Entry Point ---
main().catch(console.error);
