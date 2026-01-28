import {h, render} from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

const Plotly = window.Plotly
const RAW_DATASET = (window as any)?.RAW_DATASET
// Fixed schema as per pipeline: [author, days_bucket, lang, clusterPath, repoName, count]
const RAW_DATASET_SCHEMA = [
  "author",
  "days_bucket",
  "lang",
  "clusterPath",
  "repoName",
  "count"
];
const CLUSTER_COLUMN = RAW_DATASET_SCHEMA.indexOf("clusterPath");
const REPO_COLUMN = RAW_DATASET_SCHEMA.indexOf("repoName");
// -------- Client-side grouping/filtering engine --------
const KEY_INDEX = Object.fromEntries(
  RAW_DATASET_SCHEMA.map((k, i) => [k, i])
);
const COLUMNS_AMOUNT = RAW_DATASET[0].length - 1;
const COLUMNS_IDX_ARRAY = Array(COLUMNS_AMOUNT)
  .fill(-1)
  .map((_, i) => i);
const COUNT_IDX_FROM_END = 1; // last element is count
const COLUMN_COMPARATORS = COLUMNS_IDX_ARRAY.map((idx) => {
  const isNumber = typeof RAW_DATASET?.[0]?.[idx] === "number";
  return isNumber
    ? (a: number, b: number) => (a || 0) - (b || 0)
    : (a: string, b: string) => String(a).localeCompare(String(b));
});
const UNIQUE_VALUES = COLUMNS_IDX_ARRAY.map((idx) =>
  uniqueValues(RAW_DATASET, idx).sort(COLUMN_COMPARATORS[idx])
);

const TOP_N = 20;

function uniqueValues(arr: unknown[][], idx: number) {
  const set = new Set(arr.map((r) => r[idx]));
  return Array.from(set);
}

function matchesFilters(row: unknown[], filters: Record<number, Set<string>>) {
  for (let idx = 0; idx < COLUMNS_AMOUNT; idx++) {
    const sel = filters[idx];
    if (sel && !sel.has(String(row[idx]))) {
      return false;
    }
  }
  return true;
}

function pivot(dataset: unknown[][], column1: number, column2: number) {
  const grouped2 = new Map();
  const secValuesSet = new Set();
  for (const row of dataset) {
    const c1 = row[column1];
    const c2 = row[column2];
    const count = Number(row[row.length - COUNT_IDX_FROM_END]) || 0;
    if (!grouped2.has(c1)) grouped2.set(c1, new Map());
    grouped2.get(c1).set(c2, (grouped2.get(c1).get(c2) || 0) + count);
    secValuesSet.add(c2);
  }
  const primaryTotals = new Map();
  for (const [c1, innerMap] of grouped2) {
    let total = 0;
    for (const val of innerMap.values()) total += val;
    primaryTotals.set(c1, total);
  }
  const primaryKeys = Array.from(grouped2.keys()).sort(
    (a, b) => (primaryTotals.get(b) || 0) - (primaryTotals.get(a) || 0)
  );
  const secondaryKeys = Array.from(secValuesSet).sort((a, b) =>
    String(a).localeCompare(String(b))
  );
  return { grouped2, primaryKeys, secondaryKeys };
}

function computeColumnTotals(dataset: unknown[][], columnIdx: number) {
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
function buildSunburst(dataset: any[][], filterState: Record<number, Set<string>>) {
  const filtered = dataset.filter((row) => matchesFilters(row, filterState));

  const PSEUDO_ROOT = "@";
  // Aggregate counts per path and propagate sums up the tree
  const leafSums = new Map(); // fullPath -> sum
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
  dataset,
  filters
}: {
  dataset: unknown[][];
  filters: Record<number, Set<string>>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const data = useMemo(() => buildSunburst(dataset, filters), [dataset, filters]);

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

function MultiSelect({
  label,
  values,
  selectedSet,
  onChange
}: {
  label: string;
  values: unknown[];
  selectedSet: Set<string>;
  onChange: (value: Set<string>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredValues = useMemo(() => {
    if (!searchTerm) return values;
    const lower = searchTerm.toLowerCase();
    return values.filter((v) => String(v).toLowerCase().includes(lower));
  }, [values, searchTerm]);

  const selCount = selectedSet.size;
  const total = values.length;

  const toggleValue = (val: string) => {
    const newSet = new Set(selectedSet);
    if (newSet.has(val)) {
      newSet.delete(val);
    } else {
      newSet.add(val);
    }
    onChange(newSet);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <label className="block font-semibold mb-1.5">
        {label} <span className="text-gray-600 font-normal">({selCount}/{total})</span>
      </label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-left bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <span className="text-gray-700">
          {selCount === 0
            ? "Select..."
            : selCount === total
            ? "All selected"
            : `${selCount} selected`}
        </span>
        <span className="float-right">▼</span>
      </button>
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-hidden">
          <div className="p-2 border-b border-gray-200">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => onChange(new Set(values.map(String)))}
                className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Unselect All
              </button>
            </div>
          </div>
          <div className="overflow-y-auto max-h-64">
            {filteredValues.length === 0 ? (
              <div className="px-3 py-2 text-gray-500 text-center">No matches found</div>
            ) : (
              filteredValues.map((v) => {
                const val = String(v);
                const isChecked = selectedSet.has(val);
                return (
                  <label
                    key={val}
                    className="flex items-center px-3 py-2 hover:bg-gray-100 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleValue(val)}
                      className="mr-2 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-gray-900">{val}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
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
  const [primaryKeyIndex, setPrimaryKeyIndex] = useState(0);
  const [secondaryKeyIndex, setSecondaryKeyIndex] = useState(1);

  useMemo(() => {
    const filteredDataset = RAW_DATASET.filter((row) => matchesFilters(row, filters));
    return pivot(filteredDataset, primaryKeyIndex, secondaryKeyIndex);
  }, [filters, primaryKeyIndex, secondaryKeyIndex]);

  return (
    <div className="max-w-4xl mx-auto my-5 p-5 bg-white rounded-lg shadow-sm">
      <h1 className="border-b border-gray-300 pb-2.5">Git Contribution Statistics</h1>
      <div className="controls">
        <h2 className="border-b border-gray-300 pb-2.5">Controls</h2>
        <div className="flex gap-4 flex-wrap items-center">
          <label>
            Primary group:
            <select
              value={primaryKeyIndex}
              onChange={(e) => setPrimaryKeyIndex(Number((e.target as HTMLSelectElement).value))}
            >
              {COLUMNS_IDX_ARRAY.map((__, i) => (
                <option key={i} value={i}>
                  {RAW_DATASET_SCHEMA[i]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Secondary group:
            <select
              value={secondaryKeyIndex}
              onChange={(e) => setSecondaryKeyIndex(Number((e.target as HTMLSelectElement).value))}
            >
              {COLUMNS_IDX_ARRAY.map((__, i) => (
                <option key={i} value={i}>
                  {RAW_DATASET_SCHEMA[i]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          id="filters"
          className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
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
      </div>
      <div className="mt-8">
        <h2 className="border-b border-gray-300 pb-2.5">Column Totals</h2>
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
        <SunburstPaths dataset={RAW_DATASET} filters={filters} />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}

// Keep the symbol so template injection continues to work.
void KEY_INDEX;
