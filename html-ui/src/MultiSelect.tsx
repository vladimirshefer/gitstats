import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {h} from "preact";

export function MultiSelect(
    {
        label,
        values,
        selectedSet,
        onChange
    }: {
        label: string;
        values: any[];
        selectedSet: Set<string>;
        onChange: (value: Set<string>) => void;
    }
) {
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
                <div
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-hidden">
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