import {useMemo, useState} from "preact/hooks";
import {COLUMNS_AMOUNT, COLUMNS_IDX_ARRAY, RAW_DATASET, RAW_DATASET_SCHEMA, UNIQUE_VALUES} from "./data";
import {MultiSelect} from "./MultiSelect";
import Chart from "./Chart";
import {h} from "preact";
import {ColumnTotalCard} from "./ColumnTotalCard";
import {SunburstPaths} from "./SunburstPaths";

export function App() {
    const {initialFilters, valueOptions} = useMemo(() => {
        const filters: Record<number, Set<string>> = {};
        const options: Record<number, unknown[]> = {};
        for (let idx = 0; idx < COLUMNS_AMOUNT; idx++) {
            filters[idx] = new Set(UNIQUE_VALUES[idx].map((v) => String(v)));
            options[idx] = UNIQUE_VALUES[idx];
        }
        return {initialFilters: filters, valueOptions: options};
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
                        onChange={(newSet) => setFilters((prev) => ({...prev, [idx]: newSet}))}
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
                        const {keys, values, totals, contributions} = computeColumnTotals(
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
    totals: Map<any, number>;
    contributions: Map<any, any>
} {
    const value2total: Map<any, number> = new Map();
    const otherColumnContributions: Map<string, Map<number, Map<number, number>>> = new Map(); // Map<key, Map<otherColumnIdx, Map<otherValue, count>>>

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