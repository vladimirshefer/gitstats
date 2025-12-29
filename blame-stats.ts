#!/usr/bin/env node
/**
 * Git Blame Statistics Analyzer
 *
 * This script analyzes a Git repository's blame information to generate statistics
 * on code authorship. It can process a specific directory or file within a repo
 * and output the results in either CSV format to the console or as a self-contained
 * HTML report.
 *
 * --- CLI Usage ---
 *
 * To run the script, use the following command structure from your terminal:
 *
 *   npx ts-node blame-stats.ts [path] [--html [output_filename]] [--filename <glob>]...
 *
 *   or if compiled to javascript
 *
 *   node blame-stats.js [path] [--html [output_filename]] [--filename <glob>]... [--exclude-filename <glob>]...
 *
 *
 * Parameters:
 *
 *   [path] (optional)
 *     - The relative or absolute path to the directory or file you want to analyze.
 *     - If omitted, it defaults to the current directory (`.`).
 *
 *   --html [output_filename] (optional)
 *     - If this flag is present, the script will generate a visual HTML report.
 *     - If `[output_filename]` is provided, the report will be saved to that file.
 *     - If the filename is omitted, it defaults to 'git-blame-stats-report.html'.
 * 
 *   --filename <glob> (optional, repeatable)
 *     - Filters the files to be analyzed, including only files that match the glob pattern.
 *     - To use wildcards, enclose the pattern in quotes (e.g., `'*.ts'`).
 *     - You can use this option multiple times to include multiple patterns.
 *     - Example: --filename '*.ts' --filename '*.js'
 *
 *   --exclude-filename <glob> (optional, repeatable)
 *     - Excludes files matching the glob pattern from the analysis.
 *     - To use wildcards, enclose the pattern in quotes (e.g., `'*.json'`).
 *     - This is processed after any `--filename` filters.
 *     - Example: --exclude-filename '*.json' --exclude-filename 'dist/*'
 *
 * --- Behavior ---
 *
 * 1.  CSV Output (Default):
 *     - If the `--html` flag is not used, the script will print blame statistics
 *       in CSV format directly to the standard output.
 *     - Each row represents a committer's contribution to a single file.
 *     - The columns are: `repository_name,file_path,file_name,username,lines_for_committer,total_lines`.
 *
 * 2.  HTML Report Output (`--html`):
 *     - Generates a single, self-contained HTML file with interactive charts and a
 *       detailed table of all author statistics.
 *     - The report includes bar charts for "Lines of Code per Author" and "Files
 *       Touched per Author" for the top 20 contributors.
 *     - A full table lists every author, their total lines owned, and the number
 *       of files they've contributed to.
 *
 * --- Examples ---
 *
 *   - Analyze the entire repository and print CSV to console:
 *     npx ts-node blame-stats.ts
 *
 *   - Analyze a specific subdirectory and generate an HTML report with a default name:
 *     npx ts-node blame-stats.ts ./src --html
 *
 *   - Analyze a single file and save the HTML report with a custom name:
 *     npx ts-node blame-stats.ts ./src/index.js --html my-report.html
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- Interfaces for Data Structures ---
interface LineBlame {
    username: string;
    time: number;
    filePath: string;
}

interface AggregatedUserStats {
    username: string;
    linesLast7Days: number;
    linesLast30Days: number;
    linesLast365Days: number;
    linesLast5Years: number;
    linesLast10Years: number;
    linesOlder: number;
    totalLines: number;
    fileCount: number;
    files: Set<string>;
}

// Kept for CSV output compatibility
interface BlameRecord {
    filePath: string;
    fileName: string;
    username: string;
    linesForCommitter: number;
    totalLines: number;
}


interface CliArgs {
    targetPath: string;
    htmlOutputFile?: string;
    filenameGlobs?: string[];
    excludeGlobs?: string[];
}

// --- Main Application Logic ---

function main() {
    const args = parseArgs();
    const { lineBlames, repoRoot, originalCwd } = gatherAllLineBlames(args);

    if (args.htmlOutputFile) {
        const aggregatedData = aggregateDataForHtml(lineBlames);
        generateHtmlReport(aggregatedData, args.htmlOutputFile, originalCwd);
        console.log(`HTML report generated: ${path.resolve(originalCwd, args.htmlOutputFile)}`);
    } else {
        const records = aggregateForCsv(lineBlames);
        printCsv(records, repoRoot);
    }
}

/**
 * Aggregates line-level blame info into the legacy per-file record format for CSV output.
 */
function aggregateForCsv(lineBlames: LineBlame[]): BlameRecord[] {
    const fileUserLines = new Map<string, Map<string, number>>();
    const fileTotalLines = new Map<string, number>();

    for (const line of lineBlames) {
        if (!fileUserLines.has(line.filePath)) {
            fileUserLines.set(line.filePath, new Map<string, number>());
        }
        const userLines = fileUserLines.get(line.filePath)!;
        userLines.set(line.username, (userLines.get(line.username) || 0) + 1);
    }

    // Get total line counts for each file that has blame info
    for (const filePath of fileUserLines.keys()) {
        try {
            const totalLines = fs.readFileSync(filePath, 'utf-8').split('\n').length;
            fileTotalLines.set(filePath, totalLines);
        } catch (e) {
            fileTotalLines.set(filePath, 0); // File might not be accessible anymore
        }
    }

    const records: BlameRecord[] = [];
    for (const [filePath, userLines] of fileUserLines.entries()) {
        for (const [username, linesForCommitter] of userLines.entries()) {
            records.push({
                filePath,
                fileName: path.basename(filePath),
                username,
                linesForCommitter,
                totalLines: fileTotalLines.get(filePath) || 0
            });
        }
    }
    return records;
}


/**
 * Parses command-line arguments to determine the target path and output mode.
 */
function parseArgs(): CliArgs {
    const cliArgs = process.argv.slice(2);
    const result: Partial<CliArgs> = {
        filenameGlobs: [],
        excludeGlobs: []
    };
    
    for (let i = 0; i < cliArgs.length; i++) {
        const arg = cliArgs[i];
        if (arg === '--html') {
            const nextArg = cliArgs[i + 1];
            result.htmlOutputFile = (nextArg && !nextArg.startsWith('-')) ? nextArg : 'git-blame-stats-report.html';
            if (result.htmlOutputFile === nextArg) i++; // Consume the filename argument
        } else if (arg === '--filename') {
            const nextArg = cliArgs[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
                result.filenameGlobs!.push(nextArg);
                i++;
            }
        } else if (arg === '--exclude-filename') {
            const nextArg = cliArgs[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
                result.excludeGlobs!.push(nextArg);
                i++;
            }
        }
        else if (!arg.startsWith('-')) {
            if (!result.targetPath) result.targetPath = arg;
        }
    }
    
    result.targetPath = result.targetPath || '.';
    return result as CliArgs;
}

type LineBlameInfo = { username: string; time: number };

/**
 * Gathers blame statistics for all relevant files in the repository.
 */
function gatherAllLineBlames(args: CliArgs): { lineBlames: LineBlame[], repoRoot: string, originalCwd: string } {
    const { targetPath, filenameGlobs, excludeGlobs } = args;
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
    const includePathspecs = (filenameGlobs && filenameGlobs.length > 0)
        ? filenameGlobs.map(g => `'${g}'`).join(' ')
        : '';
    const excludePathspecs = (excludeGlobs && excludeGlobs.length > 0)
        ? excludeGlobs.map(g => `':!${g}'`).join(' ')
        : '';

    const filesCommand = `git ls-files -- "${finalTargetPath || '.'}" ${includePathspecs} ${excludePathspecs}`;
    const filesOutput = execSync(filesCommand).toString().trim();
    const files = filesOutput ? filesOutput.split('\n') : [];

    const allLineBlames: LineBlame[] = [];

    for (const file of files) {
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) continue;

        try {
            const blameOutput = execSync(`git blame --line-porcelain -- "${file}"`, { maxBuffer: 1024 * 1024 * 50 }).toString();
            
            const blameLines = blameOutput.trim().split('\n');
            const lineInfos: LineBlameInfo[] = [];
            let currentInfo: Partial<LineBlameInfo> = {};

            for (const line of blameLines) {
                if (/^[0-9a-f]{40}/.test(line)) {
                    if (currentInfo.username && currentInfo.time) {
                        lineInfos.push(currentInfo as LineBlameInfo);
                    }
                    currentInfo = {};
                } else if (line.startsWith('author ')) {
                    currentInfo.username = line.substring('author '.length).replace(/^<|>$/g, '');
                } else if (line.startsWith('committer-time ')) {
                    currentInfo.time = parseInt(line.substring('committer-time '.length), 10);
                }
            }
            if (currentInfo.username && currentInfo.time) {
                lineInfos.push(currentInfo as LineBlameInfo);
            }

            for (const info of lineInfos) {
                allLineBlames.push({
                    username: info.username,
                    time: info.time,
                    filePath: file
                });
            }
        } catch (e) {
            // Silently skip files that error (e.g., binary files)
        }
    }
    return { lineBlames: allLineBlames, repoRoot, originalCwd };
}

// --- Output Generation ---

/**
 * Aggregates raw blame records into per-user statistics for the HTML report.
 */
function aggregateDataForHtml(lineBlames: LineBlame[]): AggregatedUserStats[] {
    const userStats = new Map<string, AggregatedUserStats>();
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
    const oneYearAgo = now - 365 * 24 * 60 * 60;
    const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60;
    const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;

    for (const line of lineBlames) {
        if (!userStats.has(line.username)) {
            userStats.set(line.username, {
                username: line.username,
                linesLast7Days: 0,
                linesLast30Days: 0,
                linesLast365Days: 0,
                linesLast5Years: 0,
                linesLast10Years: 0,
                linesOlder: 0,
                totalLines: 0, 
                fileCount: 0,
                files: new Set<string>()
            });
        }
        const stats = userStats.get(line.username)!;
        stats.totalLines++;
        stats.files.add(line.filePath);

        if (line.time >= sevenDaysAgo) {
            stats.linesLast7Days++;
        } else if (line.time >= thirtyDaysAgo) {
            stats.linesLast30Days++;
        } else if (line.time >= oneYearAgo) {
            stats.linesLast365Days++;
        } else if (line.time >= fiveYearsAgo) {
            stats.linesLast5Years++;
        } else if (line.time >= tenYearsAgo) {
            stats.linesLast10Years++;
        } else {
            stats.linesOlder++;
        }
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
    console.log('repository_name,file_path,file_name,username,lines_for_committer,total_lines');
    const repoName = path.basename(repoRoot);
    for (const record of records) {
        console.log(`${repoName},"${record.filePath}","${record.fileName}",${record.username},${record.linesForCommitter},${record.totalLines}`);
    }
}

/**
 * Generates a self-contained HTML report file with charts.
 */
function generateHtmlReport(data: AggregatedUserStats[], outputFile: string, originalCwd: string) {
    const topN = 20; // Show top N users in charts
    const chartData = data.slice(0, topN);
    const labels = JSON.stringify(chartData.map(u => u.username));
    
    const linesLast7 = JSON.stringify(chartData.map(u => u.linesLast7Days));
    const linesLast30 = JSON.stringify(chartData.map(u => u.linesLast30Days));
    const linesLast365 = JSON.stringify(chartData.map(u => u.linesLast365Days));
    const linesLast5Years = JSON.stringify(chartData.map(u => u.linesLast5Years));
    const linesLast10Years = JSON.stringify(chartData.map(u => u.linesLast10Years));
    const linesOlder = JSON.stringify(chartData.map(u => u.linesOlder));

    const filesData = JSON.stringify(chartData.map(u => u.fileCount));

    const tableRows = data.map(u => `
        <tr>
            <td>${u.username}</td>
            <td class="num">${u.totalLines.toLocaleString()}</td>
            <td class="num">${u.linesLast7Days.toLocaleString()}</td>
            <td class="num">${u.linesLast30Days.toLocaleString()}</td>
            <td class="num">${u.linesLast365Days.toLocaleString()}</td>
            <td class="num">${u.linesLast5Years.toLocaleString()}</td>
            <td class="num">${u.linesLast10Years.toLocaleString()}</td>
            <td class="num">${u.linesOlder.toLocaleString()}</td>
            <td class="num">${u.fileCount.toLocaleString()}</td>
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
        th.num, td.num { text-align: right; }
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
                    <th class="num">Total Lines</th>
                    <th class="num">< 7 days</th>
                    <th class="num">8-30 days</th>
                    <th class="num">< 1 year</th>
                    <th class="num">Last 5 Years</th>
                    <th class="num">Last 10 Years</th>
                    <th class="num">Older</th>
                    <th class="num">Files Touched</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    </div>
    <script>
        const chartData = ${JSON.stringify(chartData)};
        const userMap = new Map(chartData.map(u => [u.username, u]));

        const ctxLines = document.getElementById('linesChart').getContext('2d');
        const linesChart = new Chart(ctxLines, {
            type: 'bar',
            data: {
                labels: ${labels},
                datasets: [
                    { label: '< 7 days', data: ${linesLast7}, backgroundColor: 'rgba(214, 40, 40, 0.7)' },
                    { label: '8-30 days', data: ${linesLast30}, backgroundColor: 'rgba(247, 127, 0, 0.7)' },
                    { label: '< 1 year', data: ${linesLast365}, backgroundColor: 'rgba(252, 191, 73, 0.7)' },
                    { label: 'Last 5 Years', data: ${linesLast5Years}, backgroundColor: 'rgba(54, 162, 235, 0.7)' },
                    { label: 'Last 10 Years', data: ${linesLast10Years}, backgroundColor: 'rgba(153, 102, 255, 0.7)' },
                    { label: 'Older', data: ${linesOlder}, backgroundColor: 'rgba(201, 203, 207, 0.7)' }
                ]
            },
            options: { 
                indexAxis: 'y', 
                scales: { 
                    x: { stacked: true, beginAtZero: true },
                    y: { 
                        stacked: true,
                        ticks: { autoSkip: false }
                    } 
                },
                plugins: {
                    legend: {
                        onClick: (e, legendItem, legend) => {
                            // Default behavior to toggle visibility
                            Chart.defaults.plugins.legend.onClick(e, legendItem, legend);

                            const chart = legend.chart;
                            
                            // Determine which datasets are visible
                            const visibilities = chart.data.datasets.map((_, i) => chart.isDatasetVisible(i));
                            
                            // Get the user data objects in the current order from the chart
                            const usersToSort = chart.data.labels.map(label => userMap.get(label));

                            // Sort the users based on the sum of their visible data
                            usersToSort.sort((a, b) => {
                                let totalA = 0;
                                let totalB = 0;

                                if (visibilities[0]) totalA += a.linesLast7Days;
                                if (visibilities[1]) totalA += a.linesLast30Days;
                                if (visibilities[2]) totalA += a.linesLast365Days;
                                if (visibilities[3]) totalA += a.linesLast5Years;
                                if (visibilities[4]) totalA += a.linesLast10Years;
                                if (visibilities[5]) totalA += a.linesOlder;

                                if (visibilities[0]) totalB += b.linesLast7Days;
                                if (visibilities[1]) totalB += b.linesLast30Days;
                                if (visibilities[2]) totalB += b.linesLast365Days;
                                if (visibilities[3]) totalB += b.linesLast5Years;
                                if (visibilities[4]) totalB += b.linesLast10Years;
                                if (visibilities[5]) totalB += b.linesOlder;

                                return totalB - totalA;
                            });
                            
                            // Extract new sorted data arrays
                            chart.data.labels = usersToSort.map(u => u.username);
                            chart.data.datasets[0].data = usersToSort.map(u => u.linesLast7Days);
                            chart.data.datasets[1].data = usersToSort.map(u => u.linesLast30Days);
                            chart.data.datasets[2].data = usersToSort.map(u => u.linesLast365Days);
                            chart.data.datasets[3].data = usersToSort.map(u => u.linesLast5Years);
                            chart.data.datasets[4].data = usersToSort.map(u => u.linesLast10Years);
                            chart.data.datasets[5].data = usersToSort.map(u => u.linesOlder);
                            
                            chart.update();
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.x !== null) {
                                    label += context.parsed.x.toLocaleString();
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });

        const ctxFiles = document.getElementById('filesChart').getContext('2d');
        new Chart(ctxFiles, {
            type: 'bar',
            data: {
                labels: ${labels},
                datasets: [{
                    label: 'Files Touched',
                    data: ${filesData},
                    backgroundColor: 'rgba(75, 192, 192, 0.7)',
                    borderWidth: 1
                }]
            },
            options: { 
                indexAxis: 'y', 
                scales: { 
                    x: { beginAtZero: true },
                    y: { ticks: { autoSkip: false } }
                } 
            }
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(finalOutputPath, htmlTemplate);
}

// --- Entry Point ---

main();
