#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function main() {
    // Ensure the script is run from the root of a git repository
    let repoRoot;
    try {
        repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
    } catch (e) {
        console.error('This script must be run within a git repository.');
        process.exit(1);
    }
    
    // It's easier if we run all commands from the repo root
    process.chdir(repoRoot);

    const repoName = path.basename(repoRoot);

    // Print CSV header
    console.log('repository_name,file_path,file_name,committer_email,lines_for_committer,total_lines');

    // Get all tracked files
    const files = execSync('git ls-files').toString().trim().split('\n');

    for (const file of files) {
        // Skip empty lines from split
        if (!file) continue;

        // Stat the file to ensure it exists and is a file, not a directory or submodule
        try {
            const stat = fs.statSync(file);
            if (!stat.isFile() || stat.size === 0) {
                continue;
            }
        } catch (e) {
            // This can happen if a file from `ls-files` is deleted during script execution
            continue;
        }

        const fileName = path.basename(file);
        const totalLines = fs.readFileSync(file, 'utf-8').split('\n').length;

        try {
            // Buffer might need to be large for files with long history
            const blameOutput = execSync(`git blame --line-porcelain -- "${file}"`, { maxBuffer: 1024 * 1024 * 50 }).toString();
            const authorCounts = new Map<string, number>();

            const blameLines = blameOutput.trim().split('\n');
            // Iterate through the blame output to find author lines
            for (const blameLine of blameLines) {
                if (blameLine.startsWith('author-mail ')) {
                    const email = blameLine.substring('author-mail '.length);
                    authorCounts.set(email, (authorCounts.get(email) || 0) + 1);
                }
            }
            
            // Print a CSV row for each author found in the file's blame
            for (const [email, count] of authorCounts.entries()) {
                console.log(`${repoName},"${file}","${fileName}",${email},${count},${totalLines}`);
            }

        } catch (e) {
            // Silently skip files that cause errors (e.g., binary files, files with complex history)
            // console.error(`Failed to process ${file}: ${e}`);
        }
    }
}

main();
