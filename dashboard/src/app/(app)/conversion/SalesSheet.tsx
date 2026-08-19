"use client";

import { useState } from "react";
import Link from "next/link";

export type SheetRowData = {
  name: string;
  href: string;
  cash: (number | null)[];
  work: (string | number)[];
};

export function SalesSheet({
  title,
  hint,
  cashHeaders,
  workHeaders,
  rows,
  totals,
}: {
  title: string;
  hint: string;
  cashHeaders: string[];
  workHeaders: string[];
  rows: SheetRowData[];
  totals: { cash: (number | null)[]; work: (string | number)[] };
}) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <section>
      <div className="mb-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {hint} Click the # next to a name to lock their row.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr>
              <th colSpan={2} className="sticky left-0 z-20 border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
                Rep
              </th>
              <th colSpan={cashHeaders.length} className="border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white">
                Cash
              </th>
              <th colSpan={workHeaders.length} className="border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
                The work
              </th>
            </tr>
            <tr>
              <th className="sticky left-0 z-20 w-10 min-w-10 border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-right text-[11px] font-medium text-neutral-400">#</th>
              <th className="sticky left-10 z-20 min-w-[11rem] border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-left text-[11px] font-medium text-white">Name</th>
              {cashHeaders.map((h, i) => (
                <th
                  key={h}
                  className={`border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-right text-[11px] font-medium text-white whitespace-nowrap ${i === 0 ? "min-w-[7.5rem]" : "min-w-[6.5rem]"}`}
                >
                  {h}
                </th>
              ))}
              {workHeaders.map(h => (
                <th key={h} className="border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-right text-[11px] font-medium text-neutral-200 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <SheetRow
                key={r.name}
                rank={i + 1}
                row={r}
                selected={picked === r.name}
                dimmed={picked != null && picked !== r.name}
                onPick={() => setPicked(p => p === r.name ? null : r.name)}
              />
            ))}
            <TotalRow cash={totals.cash} work={totals.work} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SheetRow({
  rank,
  row,
  selected,
  dimmed,
  onPick,
}: {
  rank: number;
  row: SheetRowData;
  selected: boolean;
  dimmed: boolean;
  onPick: () => void;
}) {
  const first = rank === 1;
  const nameBg = selected ? "bg-amber-200" : first ? "bg-amber-50" : "bg-white";
  const cashBg = selected ? "bg-amber-200" : "bg-slate-50";
  const workBg = selected ? "bg-amber-200" : "";
  const rowBg = selected ? "bg-amber-200" : first ? "bg-amber-50/50" : "bg-white";

  return (
    <tr className={`${rowBg} ${dimmed ? "opacity-35" : ""} ${selected ? "outline outline-2 outline-amber-500 -outline-offset-1" : ""}`}>
      <td className={`sticky left-0 z-10 w-10 min-w-10 border border-slate-200 px-0 py-0 ${nameBg}`}>
        <button
          type="button"
          onClick={onPick}
          title={selected ? "Clear highlight" : "Highlight this row"}
          className={`block w-full px-2 py-1.5 text-right tabular-nums hover:bg-amber-100 ${
            selected ? "font-bold text-amber-900" : "text-slate-500"
          }`}
        >
          {rank}
        </button>
      </td>
      <td className={`sticky left-10 z-10 border border-slate-200 px-2 py-1.5 whitespace-nowrap ${nameBg}`}>
        <Link href={row.href} className={`inline-flex items-center gap-1.5 font-medium hover:underline ${first || selected ? "text-amber-950" : "text-slate-900"}`}>
          {first && <Crown />}
          {row.name}
        </Link>
      </td>
      {row.cash.map((n, i) => (
        <td
          key={i}
          className={`border border-slate-200 px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${cashBg} ${
            i === 0 ? "text-[15px] font-semibold text-slate-900" : "font-medium text-slate-800"
          }`}
        >
          <Money n={n} />
        </td>
      ))}
      {row.work.map((v, i) => (
        <td key={i} className={`border border-slate-200 px-2 py-1.5 text-right tabular-nums text-slate-700 whitespace-nowrap ${workBg}`}>
          {v}
        </td>
      ))}
    </tr>
  );
}

function TotalRow({ cash, work }: { cash: (number | null)[]; work: (string | number)[] }) {
  return (
    <tr className="bg-neutral-100">
      <td className="sticky left-0 z-10 w-10 min-w-10 border border-slate-300 bg-neutral-100 px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Σ</td>
      <td className="sticky left-10 z-10 border border-slate-300 bg-neutral-100 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700">Total</td>
      {cash.map((n, i) => (
        <td key={i} className={`border border-slate-300 bg-slate-100 px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900 ${i === 0 ? "text-[15px]" : ""}`}>
          <Money n={n} />
        </td>
      ))}
      {work.map((v, i) => (
        <td key={i} className="border border-slate-300 px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">
          {v}
        </td>
      ))}
    </tr>
  );
}

function Money({ n }: { n: number | null }) {
  if (n == null || !Number.isFinite(n)) return <>—</>;
  const formatted = Math.round(Math.abs(n)).toLocaleString("en-US");
  return (
    <>
      {n < 0 ? "−" : ""}
      <span>$</span>
      {formatted}
    </>
  );
}

function Crown() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-amber-500" fill="currentColor" aria-hidden>
      <path d="M3.5 18h17l-.7-8.4a1 1 0 0 0-1.6-.7L14 12l-2.2-6.2a1 1 0 0 0-1.9 0L7.7 12 5.8 8.9a1 1 0 0 0-1.6.7L3.5 18Z" />
      <path d="M4 19.5h16v1.5H4z" />
    </svg>
  );
}
