"use client";

// Client-side filter bar. On change, updates the URL searchParams so the
// server component re-renders with the new filter set.

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

export type FilterCompany = { id: string; name: string };
export type FilterPerson = { id: string; name: string; company_id: string };

const EVENT_FILTER_OPTIONS = [
  { value: "",                   label: "All event types" },
  { value: "eod_update",         label: "EOD update" },
  { value: "quote_sent",         label: "Quote sent" },
  { value: "site_visit_booked",  label: "Site visit booked" },
  { value: "email_sent",         label: "Email sent" },
  { value: "job_won",            label: "Job won" },
];

export function Filters({
  companies,
  salesPeople,
  defaults,
}: {
  companies: FilterCompany[];
  salesPeople: FilterPerson[];
  defaults: { company: string; person: string; type: string; from: string; to: string; q: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState(defaults);

  // Keep local form synced if URL changes from elsewhere.
  useEffect(() => {
    setForm({
      company: params.get("company") || "",
      person:  params.get("person")  || "",
      type:    params.get("type")    || "",
      from:    params.get("from")    || defaults.from,
      to:      params.get("to")      || defaults.to,
      q:       params.get("q")       || "",
    });
  }, [params, defaults.from, defaults.to]);

  function apply(next: typeof form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, String(v));
    }
    router.push(`/activities?${p.toString()}`);
  }

  function update<K extends keyof typeof form>(key: K, value: string) {
    const next = { ...form, [key]: value };
    setForm(next);
    apply(next);
  }

  // Filter people to selected company (if any) — keeps the dropdown short.
  const peopleForCompany = form.company
    ? salesPeople.filter(p => p.company_id === form.company)
    : salesPeople;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 md:grid-cols-6">
      <select value={form.company} onChange={e => update("company", e.target.value)} className={selectClass}>
        <option value="">All companies</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <select value={form.person} onChange={e => update("person", e.target.value)} className={selectClass}>
        <option value="">All sales people</option>
        {peopleForCompany.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}{form.company ? "" : ` (${companies.find(c => c.id === p.company_id)?.name ?? "?"})`}
          </option>
        ))}
      </select>

      <select value={form.type} onChange={e => update("type", e.target.value)} className={selectClass}>
        {EVENT_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <input
        type="date"
        value={form.from}
        onChange={e => update("from", e.target.value)}
        className={selectClass}
        title="From"
      />
      <input
        type="date"
        value={form.to}
        onChange={e => update("to", e.target.value)}
        className={selectClass}
        title="To"
      />

      <input
        type="text"
        placeholder="Search contact name…"
        value={form.q}
        onChange={e => setForm(f => ({ ...f, q: e.target.value }))}
        onBlur={() => apply(form)}
        onKeyDown={e => { if (e.key === "Enter") apply(form); }}
        className={selectClass}
      />
    </div>
  );
}

const selectClass =
  "w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none";
