import {spawn} from "child_process";

/**
 * Executes a command asynchronously using spawn.
 * @param command The command to run
 * @param args Array of arguments
 * @param options Optional spawn options
 * @returns Promise that resolves with stdout and stderr
 */
export function execAsync(
    command: string,
    args: string[] = [],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string[]; stderr: string[] }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {...options, shell: true});

        let stdout: string[] = [];
        let stderr: string[] = [];

        child.stdout.on("data", (data) => {
            stdout.push(data.toString());
        });

        child.stderr.on("data", (data) => {
            stderr.push(data.toString());
        });

        child.on("error", (err) => {
            reject(err);
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve({stdout: stdout, stderr: stderr});
            } else {
                reject(new Error(`Command failed with code ${code}\n${stderr}`));
            }
        });
    });
}
