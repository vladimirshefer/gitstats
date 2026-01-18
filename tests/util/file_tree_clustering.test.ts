import {clusterFiles} from "../../src/util/file_tree_clustering";

describe('test cluster files', () => {
    it('empty list', () => {
        const files: string[] = []
        let clustered = clusterFiles(files, 10, 1);
        expect(clustered.map(it => it.files)).toStrictEqual([[]]);
    });

    it('single file', () => {
        const files = [
            "src/main/java/Foo.java"
        ]
        let clustered = clusterFiles(files, 10, 1);
        expect(clustered.map(it => it.files)).toStrictEqual([["src/main/java/Foo.java"]]);
    });

    it('multiple files', () => {
        const files = [
            "src/main/java/Foo.java",
            "src/main/java/Bar.java",
            "src/main/java/Baz.java",
            "src/main/resources/config.properties",
            "src/test/java/FooTest.java",
            "src/test/java/BarTest.java",
            "src/test/java/BazTest.java",
            ".gitignore"
        ]
        let clustered = clusterFiles(files, 5, 1);
        expect(clustered).toStrictEqual([
            {
                files: [
                    "src/main/java/Foo.java",
                    "src/main/java/Bar.java",
                    "src/main/java/Baz.java",
                    "src/main/resources/config.properties",
                ], path: "src/main", weight: 4, isLeftovers: false
            },
            {
                files: [
                    "src/test/java/FooTest.java",
                    "src/test/java/BarTest.java",
                    "src/test/java/BazTest.java",
                ], path: "src", weight: 3, isLeftovers: true
            },
            {
                files: [
                    ".gitignore"
                ], path: "", weight: 1, isLeftovers: true
            }
        ]);
    })

    it('per file', () => {
        const files = [
            "src/main/java/Foo.java",
            "src/main/java/Bar.java",
            "src/main/java/Baz.java",
            "src/main/java/Xyz.java",
            "src/main/java/Iop.java",
            "src/main/java/Jkl.java",
            "src/main/java/Mko.java",
        ]
        let clustered = clusterFiles(files, 5, 1);
        expect(clustered).toStrictEqual([
            {files: ["src/main/java/Foo.java"], path: "src/main/java/Foo.java", weight: 1, isLeftovers: false},
            {files: ["src/main/java/Bar.java"], path: "src/main/java/Bar.java", weight: 1, isLeftovers: false},
            {
                files: ["src/main/java/Baz.java",
                    "src/main/java/Xyz.java",
                    "src/main/java/Iop.java",
                    "src/main/java/Jkl.java",
                    "src/main/java/Mko.java"
                ], path: "src/main/java", weight: 5, isLeftovers: true
            }
        ]);
    })

    it('per file min 2', () => {
        const files = [
            "src/main/java/Foo.java",
            "src/main/java/Bar.java",
            "src/main/java/Baz.java",
            "src/main/java/Xyz.java",
            "src/main/java/Iop.java",
            "src/main/java/Jkl.java",
            "src/main/java/Mko.java",
        ]
        let clustered = clusterFiles(files, 5, 2);
        expect(clustered).toStrictEqual([
            {
                files: [
                    "src/main/java/Foo.java",
                    "src/main/java/Bar.java",
                    "src/main/java/Baz.java",
                    "src/main/java/Xyz.java",
                    "src/main/java/Iop.java",
                    "src/main/java/Jkl.java",
                    "src/main/java/Mko.java"
                ],
                path: "src/main/java", weight: 7, isLeftovers: false
            }
        ]);
    })

    it('different depth', () => {
        const files = [
            "src/main/java/foo/bar/Foo.java",
            "src/main/java/foo/bar/Bar.java",
            "src/main/java/foo/bar/Baz.java",
            "src/main/java/foo/bar/Xyz.java",
            "src/main/java/buz/Iop.java",
            "src/main/java/fgh/Jkl.java",
            "src/main/java/Mko.java",
        ]
        let clustered = clusterFiles(files, 5, 2);
        expect(clustered).toStrictEqual([
            {
                files: [
                    "src/main/java/foo/bar/Foo.java",
                    "src/main/java/foo/bar/Bar.java",
                    "src/main/java/foo/bar/Baz.java",
                    "src/main/java/foo/bar/Xyz.java"
                ], path: "src/main/java/foo", weight: 4, isLeftovers: false
            },
            {
                files: [
                    "src/main/java/buz/Iop.java",
                    "src/main/java/fgh/Jkl.java",
                    "src/main/java/Mko.java",
                ], path: "src/main/java", weight: 3, isLeftovers: true
            }
        ]);
    })
});
