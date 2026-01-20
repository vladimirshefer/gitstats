import {clusterFiles} from "../src/util/file_tree_clustering";
import {parsePorcelain} from "../src/git";

describe('test git blame porcelain', () => {
    it('base scenario', () => {
        const output = `
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
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
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1
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

    it('captures commit hash when requested', () => {
        const output = `
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2
author Alice Doe
committer-time 1700000000
filename example.txt
\tLine one
\tLine two
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 3 3 1
author Bob Smith
committer-time 1700100000
filename example.txt
\tLine three
        `.trim();

        const rows = parsePorcelain(output.split('\n'), ["commit", "author", "committer-time"]);
        expect(rows).toStrictEqual([
            ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Alice Doe", 1700000000],
            ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Alice Doe", 1700000000],
            ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Bob Smith", 1700100000],
        ]);
    });
});
