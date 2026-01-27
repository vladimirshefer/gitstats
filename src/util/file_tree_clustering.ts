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

function clusterFiles1(
    originalCluster: Cluster,
    clusterMaxSize: number,
    clusterMinSize: number
): Cluster[] | null {
    if (originalCluster.files.length <= clusterMaxSize || originalCluster.isUnclusterable) {
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
    if (newClusterFiles.length < clusterMinSize || remainingFiles.length < clusterMinSize) {
        return [{...originalCluster, isUnclusterable: true} as Cluster];
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
    ];
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
            let subclusters = clusterFiles1(originalCluster, clusterMaxSize, clusterMinSize);
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

type FileInfo = {
    arr: string[],
    str: string
}

type Cluster = {
    path: string[],
    files: FileInfo[],
    isLeftovers: boolean,
    isUnclusterable: boolean
};
