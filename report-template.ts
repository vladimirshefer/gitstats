import * as path from 'path';
import * as fs from 'fs';
import { AggregatedData, CliArgs } from './blame-stats';
import htmlTemplate from './report-template.html';

/**
 * Generates a self-contained, dynamic HTML report file with charts.
 */
export function generateHtmlReport(data: AggregatedData, outputFile: string, originalCwd: string, args: CliArgs) {
    const topN = 20; // Show top N items in charts
    const { groupBy, thenBy } = args;

    // 1. Get all primary and secondary keys from the aggregated data
    const primaryKeys = Object.keys(data);
    const allSecondaryKeys = [...new Set(primaryKeys.flatMap(pk => Object.keys(data[pk])))];

    // 2. Sort primary keys by total contribution (sum of all their secondary buckets)
    const sortedPrimaryKeys = primaryKeys.sort((a, b) => {
        const totalA = Object.values(data[a]).reduce((sum, count) => sum + count, 0);
        const totalB = Object.values(data[b]).reduce((sum, count) => sum + count, 0);
        return totalB - totalA;
    });

    // 3. Sort secondary keys (if they are date buckets, use chronological order)
    if (thenBy === 'date') {
        allSecondaryKeys.sort((a, b) => {
            if (a === 'Older') return 1;
            if (b === 'Older') return -1;
            return parseInt(a.match(/\d+/)?.[0] || '0') - parseInt(b.match(/\d+/)?.[0] || '0');
        });
    } else {
        allSecondaryKeys.sort();
    }

    // 4. Prepare data for charts (Top N) and table (all)
    const chartPrimaryKeys = sortedPrimaryKeys.slice(0, topN);
    
    const bucketColors = [
        'rgba(214, 40, 40, 0.7)',  'rgba(247, 127, 0, 0.7)',  'rgba(252, 191, 73, 0.7)',
        'rgba(168, 218, 142, 0.7)','rgba(75, 192, 192, 0.7)', 'rgba(54, 162, 235, 0.7)',
        'rgba(153, 102, 255, 0.7)','rgba(201, 203, 207, 0.7)'
    ];

    // 5. Dynamically create Chart.js datasets
    const datasets = allSecondaryKeys.map((secKey, i) => ({
        label: secKey,
        data: chartPrimaryKeys.map(pk => data[pk][secKey] || 0),
        backgroundColor: bucketColors[i % bucketColors.length],
    }));

    // 6. Dynamically create table headers and rows
    const primaryHeader = groupBy.charAt(0).toUpperCase() + groupBy.slice(1);
    const tableHeaders = `<th>${primaryHeader}</th><th class="num">Total</th>` + allSecondaryKeys.map(secKey => `<th class="num">${secKey}</th>`).join('');

    const tableRows = sortedPrimaryKeys.map(pk => {
        const total = Object.values(data[pk]).reduce((sum, count) => sum + count, 0);
        const cells = allSecondaryKeys.map(secKey => `<td class="num">${(data[pk][secKey] || 0).toLocaleString()}</td>`).join('');
        return `<tr><td>${pk}</td><td class="num">${total.toLocaleString()}</td>${cells}</tr>`;
    }).join('');

    // 7. Create dynamic titles
    const chartTitle = `Contributions by ${primaryHeader} (Top ${topN}), grouped by ${thenBy}`;

    // 8. Replace placeholders in the HTML template
    const finalOutputPath = path.join(originalCwd, outputFile);
    let htmlContent = htmlTemplate
        .replace('__CHART_TITLE__', chartTitle)
        .replace('__TABLE_HEADERS__', tableHeaders)
        .replace('__TABLE_ROWS__', tableRows)
        .replace('__CHART_LABELS_JSON__', JSON.stringify(chartPrimaryKeys))
        .replace('__CHART_DATASETS_JSON__', JSON.stringify(datasets));

    fs.writeFileSync(finalOutputPath, htmlContent);
}
