export const RAW_DATASET: any[][] = (window as any)?.RAW_DATASET

export const RAW_DATASET_SCHEMA = ["author", "days_bucket", "lang", "clusterPath", "repoName", "count"];

export const COLUMNS_AMOUNT = RAW_DATASET[0].length - 1;

export const COLUMNS_IDX_ARRAY = Array(COLUMNS_AMOUNT)
    .fill(-1)
    .map((_, i) => i);

export const COLUMN_COMPARATORS = COLUMNS_IDX_ARRAY.map((idx) => {
    const isNumber = typeof RAW_DATASET?.[0]?.[idx] === "number";
    return isNumber
        ? (a: number, b: number) => (a || 0) - (b || 0)
        : (a: string, b: string) => String(a).localeCompare(String(b));
});

export const UNIQUE_VALUES = COLUMNS_IDX_ARRAY.map((idx) =>
    uniqueValues(RAW_DATASET, idx).sort(COLUMN_COMPARATORS[idx])
);

function uniqueValues(arr: unknown[][], idx: number) {
    const set = new Set(arr.map((r) => r[idx]));
    return Array.from(set);
}

export const CLUSTER_COLUMN = RAW_DATASET_SCHEMA.indexOf("clusterPath");
export const REPO_COLUMN = RAW_DATASET_SCHEMA.indexOf("repoName");