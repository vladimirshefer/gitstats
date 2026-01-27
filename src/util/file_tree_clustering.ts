import value from "*.html";
import path from "path";

export type FileTreeCluster = {
    path: string,
    files: string[],
    weight: number,
    isLeftovers: boolean
}

export namespace graph {
    type GraphNode<T> = {
        path: string[],
        children: { [key: string]: GraphNode<T> },
        value: T,
        size: number,
    }

    export function buildGraph(
        files: FileInfo[]
    ): GraphNode<FileInfo[]> {
        const result: GraphNode<FileInfo[]> = {
            path: [],
            children: {},
            value: [],
            size: 0
        }
        files.forEach(file => {
            let targetDir = result;
            file.arr.slice(0, -1).forEach(pathSegment => {
                targetDir.size++
                if (!Object.prototype.hasOwnProperty.call(targetDir.children, pathSegment)) {
                    targetDir.children[pathSegment] = {
                        path: targetDir.path.concat([pathSegment]),
                        children: {},
                        value: [],
                        size: 0
                    }
                }
                targetDir = targetDir.children[pathSegment];
            })
            targetDir.value.push(file);
        })
        return result;
    }

    function flatten(
        graphNode: GraphNode<FileInfo[]>
    ): FileInfo[] {
        if (Object.keys(graphNode.children).length === 0) {
            return graphNode.value;
        }
        let fileInfos = Object.values(graphNode.children).flatMap(child => flatten(child));
        return fileInfos.concat(graphNode.value);
    }

    export function bubbleMicroLeftovers(
        graphNode: GraphNode<FileInfo[]>,
        clusterMaxSize: number,
        clusterMinSize: number
    ) {
        if (Object.keys(graphNode.children).length === 0) {
            return false
        }

        if (graphNode.size <= clusterMaxSize) {
            let allFiles = flatten(graphNode);
            graphNode.children = {}
            graphNode.value = allFiles;
            graphNode.size = allFiles.length;
            return true
        }

        let result = false;
        Object.entries(graphNode.children)
            .forEach(([k, child]) => {
                if (child.value.length < clusterMinSize) {
                    graphNode.value.push(...child.value);
                    graphNode.size += child.value.length;
                    child.size -= child.value.length;
                    child.value = []
                    if (child.size === 0) {
                        delete graphNode.children[k];
                        console.error('delete', graphNode.path, k)
                        result = true
                    }
                }
            })

        return result
    }

    function unpackSmallest(
        graphNode: GraphNode<FileInfo[]>,
        clusterMaxSize: number,
        clusterMinSize: number
    ): boolean {
        let childrenSortedAsc = Object.entries(graphNode.children)
            .sort((a, b) => a[1].size - b[1].size);
        if (childrenSortedAsc.length === 0) {
            return false
        }
        let [k, child] = childrenSortedAsc[0]
        let canFit = child.size + graphNode.value.length <= clusterMaxSize;
        let cannotIsolate = graphNode.value.length < clusterMinSize;
        if (canFit && cannotIsolate) {
            graphNode.value.push(...flatten(child));
            graphNode.size++;
            delete graphNode.children[k];
            console.error('delete', graphNode.path, k)
            return true
        }
        return false
    }

    export function bubbleMicroLeftoversRecursive(
        graphNode: GraphNode<FileInfo[]>,
        clusterMaxSize: number,
        clusterMinSize: number
    ): boolean {
        let changed = Object.values(graphNode.children).map(child => {
            bubbleMicroLeftoversRecursive(child, clusterMaxSize, clusterMinSize)
        }).find(Boolean) || false;
        changed = unpackSmallest(graphNode, clusterMaxSize, clusterMinSize) || changed;
        changed = bubbleMicroLeftovers(graphNode, clusterMaxSize, clusterMinSize) || changed;
        return changed;
    }

    export function collect<T>(
        graphNode: GraphNode<T>,
    ): GraphNode<T>[] {
        let result: GraphNode<T>[] = []
        function collectRecursive(node: GraphNode<T>) {
            result.push(node)
            Object.values(node.children).forEach(child => {
                collectRecursive(child)
            })
        }
        collectRecursive(graphNode)
        return result
    }
}

export function clusterFiles(
    files: string[],
    clusterMaxSize: number,
    clusterMinSize: number
): FileTreeCluster[] {

    let fileInfos = files.map(it => {
        let arr = it.split("/");
        return ({arr: arr, str: it}) as FileInfo;
    });

    let graphNode = graph.buildGraph(fileInfos);
    while (graph.bubbleMicroLeftoversRecursive(graphNode, clusterMaxSize, clusterMinSize)){}
    let subclusters = graph.collect(graphNode)
        .filter(it => it.value.length > 0)
        .sort((a, b) => b.path.join("/").localeCompare(a.path.join("/")))
        .map(it => ({
            path: it.path,
            files: it.value,
            isLeftovers: it.size > clusterMinSize,
            isUnclusterable: it.size <= clusterMinSize
        }));
    return subclusters.map((cluster) => {
        let files = cluster.files;
        let path = cluster.path;
        let files1 = files.map(it => it.str);
        return {
            path: path.join("/"),
            files: files1,
            weight: files1.length,
            isLeftovers: cluster.isLeftovers
        };
    });
}

export type FileInfo = {
    arr: string[],
    str: string
}

type Cluster = {
    path: string[],
    files: FileInfo[],
    isLeftovers: boolean,
    isUnclusterable: boolean
};
