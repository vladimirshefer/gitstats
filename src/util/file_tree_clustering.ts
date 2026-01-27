export type FileTreeCluster = {
    path: string,
    files: string[],
    weight: number,
    isLeftovers: boolean
}

function mostFrequent<T extends keyof any>(arr: T[]): T {
    const counts: Record<T, number> = {} as Record<T, number>;
    for (const item of arr) {
        counts[item] = (counts[item] || 0) + 1;
    }
    let maxCount = 0;
    let mostFrequentItem: T = arr[0];
    for (const item in counts) {
        if (counts[item] > maxCount) {
            maxCount = counts[item];
            mostFrequentItem = item;
        }
    }
    return mostFrequentItem;
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
                if (!targetDir.children[pathSegment]) {
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
            console.log("push", targetDir.path, file.str, file.arr)
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
            return
        }

        if (graphNode.size <= clusterMaxSize) {
            let allFiles = flatten(graphNode);
            return {
                path: graphNode.path,
                children: {},
                value: allFiles,
                size: graphNode.size,
            }
        }

        Object.entries(graphNode.children)
            .forEach(([k, child]) => {
                if (child.value.length < clusterMinSize) {
                    graphNode.value.push(...child.value);
                    graphNode.size += child.value.length;
                    child.size -= child.value.length;
                    child.value = []
                    if (child.size === 0) {
                        delete graphNode.children[k];
                        console.log('delete', graphNode.path, k)
                    }
                }
            })
    }

    function unpackSmallest(
        graphNode: GraphNode<FileInfo[]>,
        clusterMaxSize: number,
        clusterMinSize: number
    ) {
        let childrenSortedAsc = Object.entries(graphNode.children)
            .sort((a, b) => a[1].size - b[1].size);
        if (childrenSortedAsc.length === 0) {
            return
        }
        let [k, child] = childrenSortedAsc[0]
        let canFit = child.size + graphNode.value.length <= clusterMaxSize;
        let cannotIsolate = graphNode.value.length < clusterMinSize;
        if (canFit && cannotIsolate) {
            graphNode.value.push(...flatten(child));
            graphNode.size++;
            delete graphNode.children[k];
            console.log('delete', graphNode.path, k)
        }
    }

    export function bubbleMicroLeftoversRecursive(
        graphNode: GraphNode<FileInfo[]>,
        clusterMaxSize: number,
        clusterMinSize: number
    ) {
        Object.values(graphNode.children).forEach(child => {
            bubbleMicroLeftoversRecursive(child, clusterMaxSize, clusterMinSize)
        });
        unpackSmallest(graphNode, clusterMaxSize, clusterMinSize);
        bubbleMicroLeftovers(graphNode, clusterMaxSize, clusterMinSize);
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

function clusterFilesRecursively(
    originalCluster: Cluster,
    clusterMaxSize: number,
    clusterMinSize: number
): Cluster[] | null {
    // no need to split, cluster is already small enough
    if (originalCluster.files.length <= clusterMaxSize) {
        return null;
    }
    // cannot split, give up
    if (originalCluster.isUnclusterable) {
        return null;
    }

    let l = originalCluster.path.length // next path segment index
    let mf = mostFrequent(originalCluster.files.map(it => it.arr[l] || "$$$notfound$$$"))
    let newClusterFiles: FileInfo[] = []
    let remainingFiles = originalCluster.files.filter(it => {
        let nextPathSegment = it.arr[l];
        if (nextPathSegment === mf) {
            newClusterFiles.push(it)
            return false
        } else {
            return true
        }
    });
    if (remainingFiles.length === 0) {
        return [
            {
                path: originalCluster.path.concat([mf]),
                files: newClusterFiles,
                isLeftovers: false
            } as Cluster
        ];
    }
    if (newClusterFiles.length < clusterMinSize) {
        return [{...originalCluster, isUnclusterable: true} as Cluster];
    }
    if (remainingFiles.length < clusterMinSize) {
        // try extract some subcluster
        let subclusters = clusterFilesRecursively({
            path: originalCluster.path.concat([mf]),
            files: newClusterFiles,
            isLeftovers: false
        } as Cluster, clusterMaxSize, 1);

        // if clustering is impossible, give up and return original cluster as final
        if (subclusters === null || subclusters.length === 1) {
            return [{...originalCluster, isUnclusterable: true} as Cluster]
        }

        let sortedSubCandidatesDesc = subclusters
            .sort((a, b) => b.files.length - a.files.length);

        let okSub = []
        let microSub = []
        sortedSubCandidatesDesc.forEach(it => {
            if (it.files.length <= clusterMinSize) {
                microSub.push(it)
            } else {
                okSub.push(it)
            }
        })


    }
    return [
        {
            path: originalCluster.path.concat([mf]),
            files: newClusterFiles,
            isLeftovers: false
        } as Cluster,
        {
            path: originalCluster.path,
            files: remainingFiles,
            isLeftovers: true
        } as Cluster
    ].sort((a, b) => b.files.length - a.files.length);
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
    let initialCluster = {path: [], files: fileInfos, isLeftovers: false, isUnclusterable: false};
    let clusterGroups: Cluster[] = [initialCluster];
    let changes = true;

    while (changes) {
        changes = false;
        clusterGroups = clusterGroups.flatMap((originalCluster) => {
            let subclusters = clusterFilesRecursively(originalCluster, clusterMaxSize, clusterMinSize);
            if (subclusters !== null) {
                changes = true;
                return subclusters
            }
            return originalCluster
        })
    }
    return clusterGroups.map((cluster) => {
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
