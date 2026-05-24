// Tiny inline SVG sparkline — no extra deps.

export function Sparkline({ data, width = 96, height = 24 }: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const stepX = width / Math.max(1, data.length - 1);

  const points = data
    .map((v, i) => `${i * stepX},${height - (v / max) * (height - 2) - 1}`)
    .join(" ");

  return (
    <svg width={width} height={height} className="block">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
