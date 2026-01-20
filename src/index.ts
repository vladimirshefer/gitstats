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
import {execAsync} from './util/exec';
import * as fs from 'fs';
import * as path from 'path';
import {generateHtmlReport} from './output/report_template';
import {git_blame_porcelain, isGitRepo} from "./git";
import {RealFileSystemImpl, VirtualFileSystem} from "./vfs";
import {AsyncGeneratorUtil, AsyncIteratorWrapperImpl} from "./util/AsyncGeneratorUtil";
import {clusterFiles} from "./util/file_tree_clustering";
import {DataRow} from "./base/types";

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
    doProcessFile: (repoRoot: string, fileName: string) => Promise<DataRow[]>
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

    const finalTargetPath = path.relative(repoRoot, discoveryPath);
    const { stdout: lsFilesOut } = await execAsync(
        'git',
        ['ls-files', '--', finalTargetPath || '.'],
        { cwd: repoRoot }
    );
    const files = lsFilesOut.filter(line => line && line.length > 0);
    let minClusterSize = Math.max(5, files.length / 1000);
    const filesClustered = clusterFiles(
        files,
        Math.max(20, minClusterSize*2),
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
            yield* (await doProcessFile(repoRoot, file)).map(it => it.concat(clusterPath) as DataRow);
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

async function doProcessFile1(repoRoot: string, filePath: string): Promise<DataRow[]> {
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
    for (const item of await git_blame_porcelain(filePath, repoRoot, ["author", "committer-time"])) {
        const lang = path.extname(filePath) || 'Other';
        let days_bucket = bucket(daysAgo(item[1] as number), [0, 30, 300, 1000, 1000000]);
        if (days_bucket != -1) {
            result.push([item[0], days_bucket, lang, filePath, repoRoot]);
        }
    }
    return result;
}

/**
 * Counts distinct rows in an async generator and appends the count to each row.
 */
export async function* distinctCount(
    source: AsyncGenerator<DataRow>
): AsyncGenerator<DataRow> {
    // Map to store counts of serialized rows
    const map = new Map<string, { row: DataRow; count: number }>();

    for await (const row of source) {
        // Serialize the row to use as a Map key
        const key = JSON.stringify(row);

        if (map.has(key)) {
            map.get(key)!.count += 1;
        } else {
            map.set(key, { row, count: 1 });
        }
    }

    // Yield each distinct row with its count appended
    for (const { row, count } of map.values()) {
        yield [...row, count];
    }
}

function getRepoPathsToProcess(): string[] {
    let repoPathsToProcess: string[] = ["."]
        .flatMap(it => findRepositories(it, 3));
    repoPathsToProcess = [...new Set(repoPathsToProcess)].sort();
    if (repoPathsToProcess.length === 0) {
        throw new Error("No git repositories found to analyze.");
    }

    console.error(`Found ${repoPathsToProcess.length} repositories to analyze:`);
    repoPathsToProcess.forEach(p => console.error(`- ${p || '.'}`));
    return repoPathsToProcess;
}

// --- Main Application Controller ---
async function main() {
    const tmpVfs: VirtualFileSystem = new RealFileSystemImpl("./.git-stats/");

    process.on('SIGINT', () => {
        if (sigintCaught) {
            console.error("\nForcing exit.");
            process.exit(130);
        }
        sigintCaught = true;
        console.error("\nSignal received. Finishing current file then stopping. Press Ctrl+C again to exit immediately.");
    });

    const originalCwd = process.cwd();

    let repoPathsToProcess = getRepoPathsToProcess();

    await tmpVfs.write("data.jsonl", "");

    let dataSet = new AsyncIteratorWrapperImpl(AsyncGeneratorUtil.of(repoPathsToProcess))
        .flatMap(repoPath => forEachRepoFile(repoPath, doProcessFile1))
        .map(it => [it[0], it[1], it[2], it[5], path.basename(it[4] as string)])
        .get();

    let aggregatedData1 = distinctCount(dataSet);
    let aggregatedData = await AsyncGeneratorUtil.collect(aggregatedData1);

    let useHtml = false;

    if (useHtml) {
        const htmlFile = './.git-stats/report.html';
        generateHtmlReport(aggregatedData, htmlFile, originalCwd);
        console.error(`HTML report generated: ${path.resolve(originalCwd, htmlFile)}`);
    } else {
        aggregatedData
            .forEach ( it => tmpVfs.append(`data.jsonl`, JSON.stringify(it) + `\n`));
    }
}

function findRepositories(path: string, depth: number): string[] {
    if (depth <= 0) return [];
    if (!fs.existsSync(path)) throw new Error(`Path does not exist: ${path}`);
    if (!fs.statSync(path).isDirectory()) return [];
    if (isGitRepo(path)) return [path];
    let result = getDirectories(path).flatMap(dir => findRepositories(dir, depth - 1));
    return [...new Set(result)].sort();
}

// --- Entry Point ---
main().catch(console.error);
