import * as path from 'path';
import * as fs from 'fs';
import htmlTemplate from './report_template.html';
import {DataRow, Primitive} from "../base/types";

/**
 * Generates a self-contained, dynamic HTML report file with charts.
 */
export function generateHtmlReport(data: DataRow[], outputFile: string, originalCwd: string) {
    // Indices in DataRow based on current aggregation pipeline:
    // [author, days_bucket, lang, clusterPath, repoName, count]
    const groupByIdx = 0;      // primary: author
    const secondaryIdx = 1;    // secondary: days bucket
    const countIdxFromEnd = 1; // last element is count

    const topN = 20; // Show top N items in charts

    // Collect keys
    const primaryKeys: Primitive[] = [...new Set(data.map(it => it[groupByIdx]))];
    const allSecondaryKeys: Primitive[] = [...new Set(data.map(it => it[secondaryIdx]))];

    // Build pivot: primary -> secondary -> number
    const pivot = new Map<Primitive, Map<Primitive, number>>();
    const totals = new Map<Primitive, number>();

    for (const row of data) {
        const pk = row[groupByIdx];
        const sk = row[secondaryIdx];
        const count = Number(row[row.length - countIdxFromEnd]) || 0;

        if (!pivot.has(pk)) pivot.set(pk, new Map());
        const inner = pivot.get(pk)!;
        inner.set(sk, (inner.get(sk) || 0) + count);
        totals.set(pk, (totals.get(pk) || 0) + count);
    }

    // Sort keys
    const sortedPrimaryKeys = [...primaryKeys].sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));
    const chartPrimaryKeys = sortedPrimaryKeys.slice(0, topN);

    // Sort secondary keys (numeric if numbers, otherwise string)
    const secondarySample = allSecondaryKeys[0];
    const isNumericSecondary = typeof secondarySample === 'number' || (typeof secondarySample === 'string' && /^\d+$/.test(String(secondarySample)));
    const sortedSecondaryKeys = [...allSecondaryKeys].sort((a, b) => {
        if (isNumericSecondary) return Number(a) - Number(b);
        return String(a).localeCompare(String(b));
    });

    const bucketColors = [
        'rgba(214, 40, 40, 0.7)',  'rgba(247, 127, 0, 0.7)',  'rgba(252, 191, 73, 0.7)',
        'rgba(168, 218, 142, 0.7)','rgba(75, 192, 192, 0.7)', 'rgba(54, 162, 235, 0.7)',
        'rgba(153, 102, 255, 0.7)','rgba(201, 203, 207, 0.7)'
    ];

    // Datasets for chart (Top N primaries only)
    const datasets = sortedSecondaryKeys.map((secKey, i) => ({
        label: String(secKey),
        data: chartPrimaryKeys.map(pk => (pivot.get(pk)?.get(secKey)) || 0),
        backgroundColor: bucketColors[i % bucketColors.length],
    }));

    // Table headers and rows (all primaries)
    const primaryHeader = "Author";
    const secondaryHeader = "Age (days)";
    const tableHeaders = `<th class=\"num\">Total</th>` + sortedSecondaryKeys.map(secKey => `<th class=\"num\">${secKey}</th>`).join('');

    const tableRows = sortedPrimaryKeys.map(pk => {
        const total = totals.get(pk) || 0;
        const cells = sortedSecondaryKeys
            .map(secKey => `<td class=\"num\">${((pivot.get(pk)?.get(secKey)) || 0).toLocaleString()}</td>`)
            .join('');
        return `<tr><td>${pk}</td><td class=\"num\">${total.toLocaleString()}</td>${cells}</tr>`;
    }).join('');

    const chartTitle = `Contributions by ${primaryHeader} (Top ${topN}), grouped by ${secondaryHeader}`;

    // Replace placeholders in the HTML template
    const finalOutputPath = path.join(originalCwd, outputFile);
    let htmlContent = htmlTemplate
        .replace('__CHART_TITLE__', chartTitle)
        .replace('__TABLE_HEADERS__', tableHeaders)
        .replace('__TABLE_ROWS__', tableRows)
        .replace('__CHART_LABELS_JSON__', JSON.stringify(chartPrimaryKeys))
        .replace('__CHART_DATASETS_JSON__', JSON.stringify(datasets));

    fs.writeFileSync(finalOutputPath, htmlContent);
}
