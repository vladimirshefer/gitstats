#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function main() {
    const originalCwd = process.cwd();
    const targetArg = process.argv[2];
    
    // 1. Determine the correct directory to discover the git repo from.
    let discoveryPath = originalCwd;
    if (targetArg) {
        discoveryPath = path.resolve(originalCwd, targetArg);
    }

    if (!fs.existsSync(discoveryPath)) {
        console.error(`Error: Path does not exist: ${discoveryPath}`);
        process.exit(1);
    }
    
    // Determine the path to run git commands from (it must be a directory).
    const isDirectory = fs.statSync(discoveryPath).isDirectory();
    const gitCommandPath = isDirectory ? discoveryPath : path.dirname(discoveryPath);

    // 2. Find the repository root from that path.
    let repoRoot;
    try {
        repoRoot = execSync('git rev-parse --show-toplevel', { cwd: gitCommandPath, stdio: 'pipe' }).toString().trim();
    } catch (e) {
        console.error(`Error: Could not find a git repository at or above the path: ${gitCommandPath}`);
        process.exit(1);
    }

    // 3. Change into the correct repository root for all subsequent commands.
    process.chdir(repoRoot);

    const repoName = path.basename(repoRoot);
    
    // Determine the final path for `git ls-files`, which should be relative to the repo root.
    const finalTargetPath = path.relative(repoRoot, discoveryPath);

    const filesCommand = `git ls-files -- ${finalTargetPath || '.'}`;

    // Print CSV header
    console.log('repository_name,file_path,file_name,committer_email,lines_for_committer,total_lines');

    // Get all tracked files within the target path
    const filesOutput = execSync(filesCommand).toString().trim();
    const files = filesOutput ? filesOutput.split('\n') : [];

    for (const file of files) {
        // Skip empty lines from split
        if (!file) continue;

        // Stat the file to ensure it exists and is a file
        try {
            const stat = fs.statSync(file);
            if (!stat.isFile() || stat.size === 0) {
                continue;
            }
        } catch (e) {
            continue;
        }

        const fileName = path.basename(file);
        const totalLines = fs.readFileSync(file, 'utf-8').split('\n').length;

        try {
            const blameOutput = execSync(`git blame --line-porcelain -- "${file}"`, { maxBuffer: 1024 * 1024 * 50 }).toString();
            const authorCounts = new Map<string, number>();

            const blameLines = blameOutput.trim().split('\n');
            for (const blameLine of blameLines) {
                if (blameLine.startsWith('author-mail ')) {
                    const email = blameLine.substring('author-mail '.length);
                    authorCounts.set(email, (authorCounts.get(email) || 0) + 1);
                }
            }
            
            for (const [email, count] of authorCounts.entries()) {
                console.log(`${repoName},"${file}","${fileName}",${email},${count},${totalLines}`);
            }

        } catch (e) {
            // Silently skip files that cause errors
        }
    }
}

main();
