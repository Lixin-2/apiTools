import React from 'react';

export const CHART_COLORS = {
  accent: '#7c5cff',
  teal: '#22d3ee',
  green: '#22c55e',
  orange: '#f59e0b',
  red: '#ef4444',
  gray: '#94a3b8',
};

function useWidth(ref: React.RefObject<HTMLCanvasElement | null>) {
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!parent) return;
    const update = () => setWidth(parent.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function themeTokens() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--text-dim').trim() || '#8a8a99',
    faint: styles.getPropertyValue('--text-faint').trim() || '#9a9aab',
    grid: styles.getPropertyValue('--border-soft').trim() || '#e5e5ee',
  };
}

function niceMax(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

function prepare(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

interface LineSeries {
  label: string;
  color: string;
  values: number[];
  axis: 'left' | 'right';
}

export function LineChart({
  series,
  height = 190,
  leftUnit = '',
  rightUnit = 'ms',
}: {
  series: LineSeries[];
  height?: number;
  leftUnit?: string;
  rightUnit?: string;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const width = useWidth(ref);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width < 40) return;
    const ctx = prepare(canvas, width, height);
    if (!ctx) return;
    const tokens = themeTokens();
    const pad = { left: 46, right: 52, top: 14, bottom: 22 };
    const plotW = Math.max(10, width - pad.left - pad.right);
    const plotH = Math.max(10, height - pad.top - pad.bottom);

    const leftSeries = series.filter((item) => item.axis === 'left');
    const rightSeries = series.filter((item) => item.axis === 'right');
    const maxLeft = niceMax(Math.max(1, ...leftSeries.flatMap((item) => item.values)));
    const maxRight = niceMax(Math.max(1, ...rightSeries.flatMap((item) => item.values)));
    const count = Math.max(1, ...series.map((item) => item.values.length));

    // 网格与左右刻度
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let index = 0; index <= 4; index += 1) {
      const y = pad.top + (plotH * index) / 4;
      ctx.strokeStyle = tokens.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();

      const leftValue = maxLeft * (1 - index / 4);
      ctx.fillStyle = tokens.faint;
      ctx.textAlign = 'right';
      ctx.fillText(
        leftValue >= 100 ? Math.round(leftValue).toString() : leftValue.toFixed(1),
        pad.left - 8,
        y,
      );

      const rightValue = maxRight * (1 - index / 4);
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(rightValue)}${rightUnit}`, pad.left + plotW + 8, y);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = tokens.faint;
    const seconds = Math.round((count * 200) / 1000);
    for (let index = 0; index <= 4; index += 1) {
      const x = pad.left + (plotW * index) / 4;
      ctx.fillText(`${Math.round((seconds * index) / 4)}s`, x, pad.top + plotH + 12);
    }

    const drawSeries = (item: LineSeries, max: number) => {
      if (item.values.length < 2) return;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      item.values.forEach((value, index) => {
        const x = pad.left + (plotW * index) / Math.max(1, count - 1);
        const y = pad.top + plotH - (Math.min(value, max) / max) * plotH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    leftSeries.forEach((item) => drawSeries(item, maxLeft));
    rightSeries.forEach((item) => drawSeries(item, maxRight));

    // 图例
    let legendX = pad.left;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const item of series) {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, 4, 8, 3);
      ctx.fillStyle = tokens.text;
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.fillText(item.label, legendX + 12, 6);
      legendX += ctx.measureText(item.label).width + 30;
    }
  }, [series, width, height, rightUnit]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <canvas ref={ref} style={{ width: '100%', height }} />
    </div>
  );
}

export function BarChart({
  buckets,
  height = 150,
}: {
  buckets: [number, number][];
  height?: number;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const width = useWidth(ref);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width < 40) return;
    const ctx = prepare(canvas, width, height);
    if (!ctx) return;
    const tokens = themeTokens();
    const pad = { left: 40, right: 10, top: 12, bottom: 24 };
    const plotW = Math.max(10, width - pad.left - pad.right);
    const plotH = Math.max(10, height - pad.top - pad.bottom);
    const max = niceMax(Math.max(1, ...buckets.map(([, count]) => count)));

    ctx.strokeStyle = tokens.grid;
    ctx.lineWidth = 1;
    for (let index = 0; index <= 3; index += 1) {
      const y = pad.top + (plotH * index) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = tokens.faint;
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round((max * (3 - index)) / 3)}`, pad.left - 6, y);
    }

    const barWidth = plotW / Math.max(1, buckets.length);
    buckets.forEach(([from, count], index) => {
      const barHeight = (count / max) * plotH;
      if (barHeight <= 0) return;
      ctx.fillStyle = CHART_COLORS.accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(
        pad.left + index * barWidth + 1,
        pad.top + plotH - barHeight,
        Math.max(2, barWidth - 2),
        barHeight,
      );
      ctx.globalAlpha = 1;
    });

    ctx.fillStyle = tokens.faint;
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    [0, Math.floor(buckets.length / 2), buckets.length - 1].forEach((index) => {
      const bucket = buckets[index];
      if (!bucket) return;
      const x = pad.left + index * barWidth + barWidth / 2;
      ctx.fillText(`${bucket[0]}ms`, x, pad.top + plotH + 6);
    });
  }, [buckets, width, height]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <canvas ref={ref} style={{ width: '100%', height }} />
    </div>
  );
}

export function DonutChart({
  items,
  height = 150,
}: {
  items: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const width = useWidth(ref);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width < 40) return;
    const ctx = prepare(canvas, width, height);
    if (!ctx) return;
    const tokens = themeTokens();
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const cx = height / 2 + 6;
    const cy = height / 2;
    const radius = Math.min(height / 2 - 12, 56);

    let angle = -Math.PI / 2;
    if (total > 0) {
      for (const item of items) {
        const sweep = (item.value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 14;
        ctx.arc(cx, cy, radius, angle, angle + sweep - 0.02);
        ctx.stroke();
        angle += sweep;
      }
    } else {
      ctx.beginPath();
      ctx.strokeStyle = tokens.grid;
      ctx.lineWidth = 14;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = tokens.text;
    ctx.font = '600 12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total.toString(), cx, cy - 6);
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = tokens.faint;
    ctx.fillText('总计', cx, cy + 10);

    // 图例
    let legendY = 16;
    const legendX = cx + radius + 24;
    ctx.textAlign = 'left';
    for (const item of items) {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, legendY - 4, 8, 8);
      ctx.fillStyle = tokens.text;
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillText(`${item.label}  ${item.value}`, legendX + 14, legendY);
      legendY += 18;
    }
  }, [items, width, height]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <canvas ref={ref} style={{ width: '100%', height }} />
    </div>
  );
}
