#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- Interfaces for Data Structures ---
interface BlameRecord {
    filePath: string;
    fileName: string;
    committerEmail: string;
    linesForCommitter: number;
    totalLines: number;
}

interface AggregatedUserStats {
    email: string;
    totalLines: number;
    fileCount: number;
    files: Set<string>;
}

interface CliArgs {
    targetPath: string;
    htmlOutputFile?: string;
}

// --- Main Application Logic ---

function main() {
    const args = parseArgs();
    const { records, repoRoot, originalCwd } = gatherRepoData(args.targetPath);
    
    if (args.htmlOutputFile) {
        const aggregatedData = aggregateDataForHtml(records);
        generateHtmlReport(aggregatedData, args.htmlOutputFile, originalCwd);
        console.log(`HTML report generated: ${path.resolve(originalCwd, args.htmlOutputFile)}`);
    } else {
        printCsv(records, repoRoot);
    }
}

/**
 * Parses command-line arguments to determine the target path and output mode.
 */
function parseArgs(): CliArgs {
    const cliArgs = process.argv.slice(2);
    const result: Partial<CliArgs> = {};
    
    for (let i = 0; i < cliArgs.length; i++) {
        const arg = cliArgs[i];
        if (arg === '--html') {
            const nextArg = cliArgs[i + 1];
            result.htmlOutputFile = (nextArg && !nextArg.startsWith('-')) ? nextArg : 'git-blame-stats-report.html';
            if (result.htmlOutputFile === nextArg) i++; // Consume the filename argument
        } else if (!arg.startsWith('-')) {
            if (!result.targetPath) result.targetPath = arg;
        }
    }
    
    result.targetPath = result.targetPath || '.';
    return result as CliArgs;
}

/**
 * Gathers blame statistics for all relevant files in the repository.
 */
function gatherRepoData(targetPath: string): { records: BlameRecord[], repoRoot: string, originalCwd: string } {
    const originalCwd = process.cwd();
    const discoveryPath = path.resolve(originalCwd, targetPath);

    if (!fs.existsSync(discoveryPath)) {
        console.error(`Error: Path does not exist: ${discoveryPath}`);
        process.exit(1);
    }
    
    const gitCommandPath = fs.statSync(discoveryPath).isDirectory() ? discoveryPath : path.dirname(discoveryPath);

    let repoRoot: string;
    try {
        repoRoot = execSync('git rev-parse --show-toplevel', { cwd: gitCommandPath, stdio: 'pipe' }).toString().trim();
    } catch (e) {
        console.error(`Error: Could not find a git repository at or above the path: ${gitCommandPath}`);
        process.exit(1);
    }

    process.chdir(repoRoot);
    
    const finalTargetPath = path.relative(repoRoot, discoveryPath);
    const filesCommand = `git ls-files -- ${finalTargetPath || '.'}`;
    const filesOutput = execSync(filesCommand).toString().trim();
    const files = filesOutput ? filesOutput.split('\n') : [];

    const allRecords: BlameRecord[] = [];

    for (const file of files) {
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) continue;

        const totalLines = fs.readFileSync(file, 'utf-8').split('\n').length;
        const fileName = path.basename(file);

        try {
            const blameOutput = execSync(`git blame --line-porcelain -- "${file}"`, { maxBuffer: 1024 * 1024 * 50 }).toString();
            const authorCounts = new Map<string, number>();

            blameOutput.trim().split('\n').forEach(line => {
                if (line.startsWith('author-mail ')) {
                    const email = line.substring('author-mail '.length);
                    authorCounts.set(email, (authorCounts.get(email) || 0) + 1);
                }
            });
            
            for (const [email, count] of authorCounts.entries()) {
                allRecords.push({
                    filePath: file,
                    fileName: fileName,
                    committerEmail: email,
                    linesForCommitter: count,
                    totalLines: totalLines
                });
            }
        } catch (e) {
            // Silently skip files that error (e.g., binary files)
        }
    }
    return { records: allRecords, repoRoot, originalCwd };
}

// --- Output Generation ---

/**
 * Aggregates raw blame records into per-user statistics for the HTML report.
 */
function aggregateDataForHtml(records: BlameRecord[]): AggregatedUserStats[] {
    const userStats = new Map<string, AggregatedUserStats>();
    for (const record of records) {
        if (!userStats.has(record.committerEmail)) {
            userStats.set(record.committerEmail, { 
                email: record.committerEmail, 
                totalLines: 0, 
                fileCount: 0,
                files: new Set<string>()
            });
        }
        const stats = userStats.get(record.committerEmail)!;
        stats.totalLines += record.linesForCommitter;
        stats.files.add(record.filePath);
    }

    // Convert map to array and calculate final file counts
    return Array.from(userStats.values()).map(stats => ({
        ...stats,
        fileCount: stats.files.size
    })).sort((a, b) => b.totalLines - a.totalLines);
}

/**
 * Prints the collected data in CSV format to the console.
 */
function printCsv(records: BlameRecord[], repoRoot: string) {
    console.log('repository_name,file_path,file_name,committer_email,lines_for_committer,total_lines');
    const repoName = path.basename(repoRoot);
    for (const record of records) {
        console.log(`${repoName},"${record.filePath}","${record.fileName}",${record.committerEmail},${record.linesForCommitter},${record.totalLines}`);
    }
}

/**
 * Generates a self-contained HTML report file with charts.
 */
function generateHtmlReport(data: AggregatedUserStats[], outputFile: string, originalCwd: string) {
    const topN = 20; // Show top N users in charts
    const chartData = data.slice(0, topN);
    const labels = JSON.stringify(chartData.map(u => u.email));
    const linesData = JSON.stringify(chartData.map(u => u.totalLines));
    const filesData = JSON.stringify(chartData.map(u => u.fileCount));

    const tableRows = data.map(u => `
        <tr>
            <td>${u.email}</td>
            <td>${u.totalLines.toLocaleString()}</td>
            <td>${u.fileCount.toLocaleString()}</td>
        </tr>
    `).join('');
    
    const finalOutputPath = path.join(originalCwd, outputFile);

    const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Blame Statistics</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background-color: #f8f9fa; color: #212529; }
        .container { max-width: 1200px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 0 15px rgba(0,0,0,0.05); }
        h1, h2 { border-bottom: 1px solid #dee2e6; padding-bottom: 10px; }
        .chart-container { display: flex; gap: 20px; margin-top: 20px; flex-wrap: wrap; }
        .chart { flex: 1 1 45%; min-width: 300px; }
        table { width: 100%; border-collapse: collapse; margin-top: 30px; }
        th, td { padding: 12px; border: 1px solid #dee2e6; text-align: left; }
        thead { background-color: #e9ecef; }
        tbody tr:nth-child(odd) { background-color: #f8f9fa; }
        tbody tr:hover { background-color: #e9ecef; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Git Blame Statistics</h1>
        <div class="chart-container">
            <div class="chart">
                <h2>Lines of Code per Author (Top ${topN})</h2>
                <canvas id="linesChart"></canvas>
            </div>
            <div class="chart">
                <h2>Files Touched per Author (Top ${topN})</h2>
                <canvas id="filesChart"></canvas>
            </div>
        </div>
        <h2>All Author Stats</h2>
        <table>
            <thead>
                <tr>
                    <th>Author</th>
                    <th>Total Lines Owned</th>
                    <th>Total Files Touched</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    </div>
    <script>
        const ctxLines = document.getElementById('linesChart').getContext('2d');
        new Chart(ctxLines, {
            type: 'bar',
            data: {
                labels: ${labels},
                datasets: [{
                    label: 'Lines of Code',
                    data: ${linesData},
                    backgroundColor: 'rgba(0, 123, 255, 0.7)',
                    borderColor: 'rgba(0, 123, 255, 1)',
                    borderWidth: 1
                }]
            },
            options: { indexAxis: 'y', scales: { y: { beginAtZero: true } } }
        });

        const ctxFiles = document.getElementById('filesChart').getContext('2d');
        new Chart(ctxFiles, {
            type: 'bar',
            data: {
                labels: ${labels},
                datasets: [{
                    label: 'Files Touched',
                    data: ${filesData},
                    backgroundColor: 'rgba(40, 167, 69, 0.7)',
                    borderColor: 'rgba(40, 167, 69, 1)',
                    borderWidth: 1
                }]
            },
            options: { indexAxis: 'y', scales: { y: { beginAtZero: true } } }
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(finalOutputPath, htmlTemplate);
}

// --- Entry Point ---

main();
