import {clusterFiles} from "../src/util/file_tree_clustering";
import {parsePorcelain} from "../src/git";

describe('test git blame porcelain', () => {
    it('base scenario', () => {
        const output = `
a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8 1 1 1
author Alice Doe
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice Doe
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary Initial commit
filename example.txt
\tHello world
f9e8d7c6b5a4a3b2c1d0f9e8d7c6b5a4a3b2c1d0 2 2 1
author Bob Smith
author-mail <bob@example.com>
author-time 1700100000
author-tz +0000
committer Bob Smith
committer-mail <bob@example.com>
committer-time 1700100000
committer-tz +0000
summary Update farewell line
filename example.txt
\tGoodbye world
        `.trim()
        let parsePorcelain1 = parsePorcelain(output.split("\n"), ["author", "committer-time"]);
        expect(parsePorcelain1).toStrictEqual([
            ["Alice Doe", 1700000000],
            ["Bob Smith", 1700100000]
        ])
    });
});
