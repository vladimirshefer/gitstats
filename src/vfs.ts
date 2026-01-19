import fs from "fs";
import path from "path";

export interface VirtualFileSystem {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    append(path: string, content: string): Promise<void>;
}

export class RealFileSystemImpl implements VirtualFileSystem {
    basePath: String

    constructor(basePath: string) {
        this.basePath = path.normalize(basePath);
    }

    async read(filePath: string): Promise<string> {
        return fs.readFileSync(this.resolve(filePath), 'utf8');
    }

    async write(filePath: string, content: string): Promise<void> {
        let path1 = path.resolve(this.resolve(filePath), "..");
        console.log(`creating directory ${path1}`)
        fs.mkdirSync(path1, {recursive: true})
        fs.writeFileSync(this.resolve(filePath), content);
    }

    async append(filePath: string, content: string): Promise<void> {
        fs.appendFileSync(this.resolve(filePath), content);
    }

    private resolve(filePath: string) {
        return path.normalize(`${this.basePath}/${filePath}`);
    }
}

export class InMemoryFileSystemImpl implements VirtualFileSystem{
    data: Record<string, string> = {};
    constructor() {

    }

    async write(path: string, content: string): Promise<void> {
        this.data[path] = content;
    }

    async read(path: string): Promise<string> {
        return this.data[path];
    }

    async append(path: string, content: string): Promise<void> {
        this.data[path] += "\n";
        this.data[path] += content;
    }

}
