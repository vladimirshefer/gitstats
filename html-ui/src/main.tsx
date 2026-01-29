import {h, render} from "preact";
import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {COLUMNS_AMOUNT, COLUMNS_IDX_ARRAY, RAW_DATASET, RAW_DATASET_SCHEMA, UNIQUE_VALUES} from "./data";
import {MultiSelect} from "./MultiSelect";
import Chart from "./Chart";

const Plotly = window.Plotly
export const CLUSTER_COLUMN = RAW_DATASET_SCHEMA.indexOf("clusterPath");
export const REPO_COLUMN = RAW_DATASET_SCHEMA.indexOf("repoName");

function matchesFilters(row: unknown[], filters: Record<number, Set<string>>) {
  for (let idx = 0; idx < COLUMNS_AMOUNT; idx++) {
    const sel = filters[idx];
    if (sel && !sel.has(String(row[idx]))) {
      return false;
    }
  }
  return true;
}

function computeColumnTotals(dataset: any[][], columnIdx: number): {
  keys: any[];
  values: any[];
  totals: Map<any, any>;
  contributions: Map<any, any>
} {
  const value2total = new Map();
  const otherColumnContributions = new Map(); // Map<key, Map<otherColumnIdx, Map<otherValue, count>>>

  for (const row of dataset) {
    const value = row[columnIdx];
    const count = Number(row[row.length - 1]) || 0;
    value2total.set(value, (value2total.get(value) || 0) + count);

    // Track contributions from other columns
    if (!otherColumnContributions.has(value)) {
      otherColumnContributions.set(value, new Map());
    }
    const keyContribs = otherColumnContributions.get(value);

    for (let otherIdx = 0; otherIdx < COLUMNS_AMOUNT; otherIdx++) {
      if (otherIdx === columnIdx) continue;

      if (!keyContribs.has(otherIdx)) {
        keyContribs.set(otherIdx, new Map());
      }
      const otherColMap = keyContribs.get(otherIdx);
      const otherValue = row[otherIdx];
      otherColMap.set(otherValue, (otherColMap.get(otherValue) || 0) + count);
    }
  }

  const sorted = Array.from(value2total.entries()).sort((a, b) => b[1] - a[1]);

  return {
    keys: sorted.map(([k]) => k),
    values: sorted.map(([, v]) => v),
    totals: value2total,
    contributions: otherColumnContributions
  };
}

// ---------- Components ----------
function ColumnTotalCard({
  columnName,
  columnIdx,
  keys,
  values,
  totals,
  contributions
}: {
  columnName: string;
  columnIdx: number;
  keys: unknown[];
  values: number[];
  totals: Map<unknown, number>;
  contributions: Map<
    unknown,
    Map<number, Map<unknown, number>>
  >;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { labels, hoverText } = useMemo(() => {
    const labels: string[] = [];
    const hoverText: string[] = [];

    keys.forEach((k) => {
      const total = totals.get(k) || 0;
      const keyContribs = contributions.get(k);
      const topContribs: string[] = [];

      for (let otherIdx = 0; otherIdx < COLUMNS_AMOUNT; otherIdx++) {
        if (otherIdx === columnIdx) continue;
        const otherColMap = keyContribs?.get(otherIdx);
        if (otherColMap) {
          const top3 = Array.from(otherColMap.entries())
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .slice(0, 3)
            .map(
              ([val, cnt]) =>
                `${val}(${((cnt as number) / total * 100.0).toFixed(1)}%)`
            )
            .join("<br>-");
          if (top3) {
            topContribs.push(`${RAW_DATASET_SCHEMA[otherIdx]}<br>-` + top3);
          }
        }
      }

      const label = `${String(k)} (${total})`;
      labels.push(label);
      hoverText.push(
        topContribs.length > 0
          ? `${label}<br>${topContribs.join("<br>")}`
          : label
      );
    });

    return { labels, hoverText };
  }, [columnName, columnIdx, keys, totals, contributions]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!labels.length) {
      el.innerHTML =
        '<div class="text-gray-500 py-6 text-center">No data to display</div>';
      return;
    }
    const trace = {
      type: "sunburst",
      labels: labels,
      parents: labels.map(() => ""),
      values: values,
      hovertext: hoverText,
      hovertemplate: "%{hovertext}<extra></extra>",
      branchvalues: "total"
    };
    const layout = {
      margin: { l: 0, r: 0, t: 10, b: 10 },
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
      height: 300
    };
    const config = { responsive: true, displayModeBar: false };
    Plotly.newPlot(el, [trace], layout, config);
  }, [labels, hoverText, values]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <h3 className="text-lg font-semibold mb-3 text-gray-800">
        {columnName} - Total
      </h3>
      <div ref={containerRef} className="w-full" />
    </div>
  );
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

  if (allPaths.size === 0) return { ids: [], labels: [], parents: [], values: [] };

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

  return { ids, labels, parents, values };
}

function SunburstPaths({
  dataset
}: {
  dataset: any[][];
}) {
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
      margin: { l: 0, r: 0, t: 10, b: 10 },
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
    const config = { responsive: true, displayModeBar: false };
    Plotly.newPlot(el, [trace], layout, config);
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}

function App() {
  const { initialFilters, valueOptions } = useMemo(() => {
    const filters: Record<number, Set<string>> = {};
    const options: Record<number, unknown[]> = {};
    for (let idx = 0; idx < COLUMNS_AMOUNT; idx++) {
      filters[idx] = new Set(UNIQUE_VALUES[idx].map((v) => String(v)));
      options[idx] = UNIQUE_VALUES[idx];
    }
    return { initialFilters: filters, valueOptions: options };
  }, []);
  const [filters, setFilters] = useState(initialFilters);
  const filteredDataset = useMemo(() => RAW_DATASET.filter(it => matchesFilters(it, filters)), [filters]);
  const datesData = useMemo(() => {
    const d = new Map<number, number>();
    let dateIndex = RAW_DATASET_SCHEMA.indexOf("days_bucket");
    let min = null;
    let max = null;
    filteredDataset.forEach(row => {
      const date = row[dateIndex];
      const count = Number(row[COLUMNS_AMOUNT]) || 0;
      d.set(date, (d.get(date) || 0) + count);
      console.error("ADD", date)
      if (!min || date < min) min = date;
      if (!max || date > max) max = date;
    });
    for (let i = min; i < max; i++) {
      if (i % 10 > 0 && i % 10 <= 4 && !d.has(i)) {
        d.set(i, 0);
        console.error("ADD", i)
      }
    }
    return Array.from(d.entries()).sort((a, b) => a[0] - b[0]);
  }, [filteredDataset])
  console.error("DATES", datesData)

  return (
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm p-4">
      <h1 className="border-gray-300 text-xl">Git Contribution Statistics</h1>
      <div
        id="filters"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
      >
        {COLUMNS_IDX_ARRAY.map((__, idx) => (
          <MultiSelect
            key={idx}
            label={RAW_DATASET_SCHEMA[idx]}
            values={valueOptions[idx]}
            selectedSet={filters[idx]}
            onChange={(newSet) => setFilters((prev) => ({ ...prev, [idx]: newSet }))}
          />
        ))}
      </div>
        <div>
          <Chart
              data={[
                {
                  x: datesData.map(it => it[0]),
                  y: datesData.map(it => it[1]),
                  type: 'scatter',
                  line: {
                    shape: 'spline',
                    smoothing: 1.3   // 0–1.3 (higher = smoother)
                  }
                }
              ]}
              layout={{
                xaxis: {
                  visible: false,
                  type: 'category' // prevent converting to numbers
                },
                yaxis: {
                  visible: false
                },
                height: 150,
                margin: {
                  l: 0,
                  r: 0,
                  t: 0,
                  b: 0,
                  pad: 0
                },
                bargap: 0,
                bargroupgap: 0,
                selectdirection: 'h',  // horizontal-only
                zoomdirection: 'x',    // x-only
              }}
              config={{
                displayModeBar: false,
                displaylogo: false,
              }}
          />
        </div>
        <div>
          <h2 className="border-b border-gray-300">Column Totals</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {COLUMNS_IDX_ARRAY.map((__, idx) => {
            const filteredDataset = RAW_DATASET.filter((row) => matchesFilters(row, filters));
            const { keys, values, totals, contributions } = computeColumnTotals(
              filteredDataset,
              idx
            );
            return (
              <ColumnTotalCard
                key={idx}
                columnName={RAW_DATASET_SCHEMA[idx]}
                columnIdx={idx}
                keys={keys}
                values={values as number[]}
                totals={totals}
                contributions={contributions}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-8">
        <h2 className="border-b border-gray-300 pb-2.5">Repository Paths Sunburst</h2>
        <p className="text-sm text-gray-600 mt-2 mb-3">
          Breakdown by folder structure based on <code>clusterPath</code> within current filters.
        </p>
        <SunburstPaths dataset={filteredDataset}/>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}
