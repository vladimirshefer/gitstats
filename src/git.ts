import path from "path";
import {DataRow} from "./index";
import fs from "fs";
import {execAsync} from "./util/exec";

/**
 * Executes git blame --line-porcelain for a file and returns the raw output as a string.
 *
 * @param file - relative path to the file within the repository
 * @param repoRoot - absolute path to the repository root
 * @param revisionBoundary
 * @param since
 * @returns plain string output from git blame --line-porcelain
 */
export async function executeGitBlamePorcelain(
    file: string,
    repoRoot: string,
    revisionBoundary?: string,
    since?: string
): Promise<string> {
    const args = ["blame", "--line-porcelain"];

    if (since) {
        args.push(`--since=${since}`);
    }
    if (revisionBoundary) {
        args.push(revisionBoundary);
    }

    args.push("--", file);

    const { stdout } = await execAsync("git", args, { cwd: repoRoot });
    return stdout;
}

/**
 * Extracts line-by-line authorship statistics from a file using git blame.
 *
 * Uses `git blame --line-porcelain` to get detailed commit information for each line.
 *
 * Example of git blame --line-porcelain output:
 * ```
 * a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0 1 1 1
 * author John Doe
 * author-mail <john.doe@example.com>
 * author-time 1609459200
 * author-tz +0000
 * committer Jane Smith
 * committer-mail <jane.smith@example.com>
 * committer-time 1609545600
 * committer-tz +0000
 * summary Initial commit
 * filename src/example.ts
 *    import { something } from './module';
 * a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0 2 2
 * author John Doe
 * author-mail <john.doe@example.com>
 * author-time 1609459200
 * author-tz +0000
 * committer Jane Smith
 * committer-mail <jane.smith@example.com>
 * committer-time 1609545600
 * committer-tz +0000
 * summary Initial commit
 * filename src/example.ts
 *    some text
 * b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0a1 3 3 1
 * author Alice Johnson
 * author-mail <alice@example.com>
 * author-time 1612137600
 * author-tz +0000
 * committer Alice Johnson
 * committer-mail <alice@example.com>
 * committer-time 1612137600
 * committer-tz +0000
 * summary Add new feature
 * previous b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0 src/example.ts
 * filename src/example.ts
 *    export function newFeature() {
 * ```
 *
 * Each line of actual code is prefixed with a tab character.
 * The parser extracts the author name and committer-time for each code line.
 *
 * @param file - relative path to the file within the repository
 * @param repoRoot - absolute path to the repository root
 * @param fields
 */
export async function git_blame_porcelain(file: string, repoRoot: string, fields: string[]): Promise<DataRow[]> {
    const blameOutput = await executeGitBlamePorcelain(file, repoRoot);
    return parsePorcelain(blameOutput, fields);
}

export function parsePorcelain(blameOutput: string, fields: string[]): DataRow[] {
    const blameLines = blameOutput.trim().split('\n');

    const userPos = fields.indexOf("author");
    const commiterTimePos = fields.indexOf("committer-time");
    const boundaryPos = fields.indexOf("boundary");
    let emptyRow: DataRow = [...fields];
    if (commiterTimePos >= 0) {
        emptyRow[commiterTimePos] = 0
    }
    if (boundaryPos >= 0) {
        emptyRow[boundaryPos] = false
    }
    let nextRow: DataRow = [...emptyRow]
    const result: DataRow[] = [];
    for (const line of blameLines) {
        if (line.startsWith('\t')) {
            result.push(nextRow);
            nextRow = [...emptyRow]
            continue;
        }
        if (userPos >= 0 && line.startsWith('author ')) {
            nextRow[userPos] = line.substring('author '.length).replace(/^<|>$/g, '');
            continue;
        }
        if (commiterTimePos >= 0 && line.startsWith('committer-time ')) {
            nextRow[commiterTimePos] = parseInt(line.substring('committer-time '.length), 10);
            continue;
        }
        if (boundaryPos >= 0 && line.startsWith("boundary")) {
            nextRow[boundaryPos] = true
        }
    }

    return result;
}

export function isGitRepo(dir: string): boolean {
    return fs.existsSync(path.join(dir, '.git'));
}