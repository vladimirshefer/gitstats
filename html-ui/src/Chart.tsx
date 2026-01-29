import {useEffect, useRef} from "preact/hooks";
import {h} from "preact";
import Plotly from "plotly.js";

export default function Chart(
    {
        data,
        layout,
        config
    }: {
        data: any,
        layout: Partial<Plotly.Layout>,
        config: Partial<Plotly.Config>,
    }
) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        Plotly.newPlot(el, data, layout, config);
    }, [data, layout, config]);

    return <div ref={containerRef} className="w-full"/>;
}
