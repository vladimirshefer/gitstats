import {useEffect, useMemo, useRef} from "preact/hooks";
import {h} from "preact";
import {CLUSTER_COLUMN, COLUMNS_AMOUNT, REPO_COLUMN} from "./data";

export function SunburstPaths(
    {
        dataset
    }: {
        dataset: any[][];
    }
) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const data = useMemo(() => buildSunburst(dataset), [dataset]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        if (!data.ids.length) {
            el.innerHTML =
                '<div class="text-gray-500 py-6 text-center">No path data to display</div>';
            return;
        }
        const trace = {
            type: "sunburst",
            ids: data.ids,
            labels: data.labels,
            parents: data.parents,
            values: data.values,
            branchvalues: "total",
            maxdepth: 3
        };
        const layout = {
            margin: {l: 0, r: 0, t: 10, b: 10},
            sunburstcolorway: [
                "#4F46E5",
                "#10B981",
                "#F59E0B",
                "#EF4444",
                "#06B6D4",
                "#8B5CF6",
                "#F43F5E"
            ],
            extendsunburstcolors: true,
            height: 400
        };
        const config = {responsive: true, displayModeBar: false};
        Plotly.newPlot(el, [trace], layout, config);
    }, [data]);

    return <div ref={containerRef} className="w-full"/>;
}

// ---------- Sunburst over repository paths (clusterPath) ----------
function buildSunburst(dataset: any[][]): {
    ids: string[];
    labels: string[];
    parents: string[];
    values: number[]
} {
    const filtered: any[][] = dataset;

    const leafSums = new Map<string, number>(); // fullPath -> sum
    const allPaths = new Set<string>(); // includes all prefixes (no empty)

    for (const row of filtered) {
        const rawPath = String(row[REPO_COLUMN] + "/" + row[CLUSTER_COLUMN]).trim();
        const cnt = Number(row[COLUMNS_AMOUNT]) || 0;
        if (!rawPath) continue;
        const segs = rawPath.split("/").filter((s) => s && s !== ".");
        if (segs.length === 0) continue;
        const full = segs.join("/");
        leafSums.set(full, (leafSums.get(full) || 0) + cnt);
        // Collect all prefix nodes for structure
        for (let i = 0; i < segs.length; i++) {
            const p = segs.slice(0, i + 1).join("/");
            allPaths.add(p);
        }
    }

    if (allPaths.size === 0) return {ids: [], labels: [], parents: [], values: []};

    // Compute total values for every node as sum of its descendant leaves
    const totals = new Map(Array.from(allPaths, (p) => [p, 0]));
    for (const [leaf, v] of leafSums) {
        const segs = leaf.split("/");
        for (let i = 0; i < segs.length; i++) {
            const p = segs.slice(0, i + 1).join("/");
            totals.set(p, (totals.get(p) || 0) + v);
        }
    }

    // Build Plotly arrays
    const ids: string[] = [];
    const labels: string[] = [];
    const parents: string[] = [];
    const values: number[] = [];

    // Ensure stable ordering: sort by path length then alphabetically
    const ordered = Array.from(allPaths);
    ordered.sort((a: string, b: string) => {
        const da = a.split("/").length,
            db = b.split("/").length;
        if (da !== db) return da - db;
        return a.localeCompare(b);
    });

    for (const id of ordered) {
        const segs = id.split("/");
        const label = segs[segs.length - 1] || id;
        const parent = segs.length > 1 ? segs.slice(0, -1).join("/") : "";
        ids.push(id);
        labels.push(label);
        parents.push(parent);
        values.push(totals.get(id) || 0);
    }

    return {ids, labels, parents, values};
}