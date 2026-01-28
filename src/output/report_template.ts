import * as path from 'path';
import * as fs from 'fs';
// @ts-ignore
import htmlTemplate from '../../html-ui/dist/index.html';
import {DataRow} from "../base/types";

/**
 * Generates a self-contained, dynamic HTML report file with charts.
 */
export function generateHtmlReport(data: DataRow[], outputFile: string) {
    const finalOutputPath = path.join(outputFile);
    let htmlContent = htmlTemplate.split("__DATASET_JSON__")
    fs.writeFileSync(finalOutputPath, htmlContent[0]);
    fs.appendFileSync(finalOutputPath, "\n[\n")
    for (let i = 0; i < data.length; i++) {
        fs.appendFileSync(finalOutputPath, JSON.stringify(data[i]) + ",\n")
    }
    fs.appendFileSync(finalOutputPath, "\n]\n")
    fs.appendFileSync(finalOutputPath, htmlContent[1]);
}
