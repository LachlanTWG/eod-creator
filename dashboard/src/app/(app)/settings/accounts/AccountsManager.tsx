"use client";

import { useState } from "react";
import {
  grantCompanyAccess,
  inviteUser,
  revokeCompanyAccess,
  setUserRole,
  type AccountRow,
} from "./actions";
import type { AppRole, CompanyAccess } from "@/lib/viewer";

const ROLE_LABEL: Record<AppRole, string> = {
  owner: "Owner",
  twg: "TWG",
  conversion: "Conversion lead",
  team: "Team",
  client: "Client",
};

const ACCESS_LABEL: Record<CompanyAccess, string> = {
  leader: "Leader",
  conversion: "Conversion",
  member: "Member",
  client: "Client",
  twg: "TWG",
};

export function AccountsManager({
  people,
  companies,
}: {
  people: AccountRow[];
  companies: { id: string; name: string; slug: string }[];
}) {
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: true; tempPassword?: string } | { ok: false; error: string }>) {
    setBusy(true);
    setFlash(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setFlash({ kind: "error", text: res.error });
      return;
    }
    if ("tempPassword" in res && res.tempPassword) {
      setFlash({ kind: "ok", text: `Account created. Temporary password: ${res.tempPassword}` });
    } else {
      setFlash({ kind: "ok", text: "Saved." });
    }
  }

  return (
    <div className="space-y-8">
      {flash && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            flash.kind === "ok"
              ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
              : "border-red-700/40 bg-red-900/20 text-red-200"
          }`}
        >
          {flash.text}
        </div>
      )}

      <section className="rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-200">Invite someone</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Sends a Supabase invite when email is configured; otherwise creates a login and shows a temporary password.
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          action={fd => run(() => inviteUser(fd))}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="name@company.com"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
          />
          <select name="role" defaultValue="team" className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select name="companyId" defaultValue="" className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
            <option value="">No client yet</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select name="access" defaultValue="member" className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
            {Object.entries(ACCESS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Invite
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-normal">Person</th>
              <th className="px-4 py-2 text-left font-normal">Role</th>
              <th className="px-4 py-2 text-left font-normal">Access</th>
              <th className="px-4 py-2 text-left font-normal">Grant</th>
            </tr>
          </thead>
          <tbody>
            {people.map(p => (
              <tr key={p.id} className="border-t border-zinc-800 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">{p.fullName || p.email.split("@")[0]}</div>
                  <div className="text-xs text-zinc-500">{p.email}</div>
                </td>
                <td className="px-4 py-3">
                  <form action={fd => run(() => setUserRole(fd))}>
                    <input type="hidden" name="userId" value={p.id} />
                    <select
                      name="role"
                      defaultValue={p.role}
                      onChange={e => e.currentTarget.form?.requestSubmit()}
                      className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
                    >
                      {Object.entries(ROLE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </form>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1.5">
                    {p.roster.map(r => (
                      <span key={`r-${r.companyId}`} className="text-xs text-zinc-400">
                        Roster · {r.companyName}
                      </span>
                    ))}
                    {p.memberships.map(m => (
                      <form
                        key={`m-${m.companyId}`}
                        className="flex items-center gap-2 text-xs"
                        action={fd => run(() => revokeCompanyAccess(fd))}
                      >
                        <input type="hidden" name="userId" value={p.id} />
                        <input type="hidden" name="companyId" value={m.companyId} />
                        <span className="text-zinc-300">
                          {ACCESS_LABEL[m.access]} · {m.companyName}
                        </span>
                        <button type="submit" className="text-zinc-500 hover:text-red-300">
                          remove
                        </button>
                      </form>
                    ))}
                    {p.roster.length === 0 && p.memberships.length === 0 && (
                      <span className="text-xs text-zinc-600">No clients</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <form className="flex flex-col gap-2" action={fd => run(() => grantCompanyAccess(fd))}>
                    <input type="hidden" name="userId" value={p.id} />
                    <select name="companyId" required className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
                      <option value="">Client…</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select name="access" defaultValue="leader" className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
                      {Object.entries(ACCESS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <button type="submit" className="text-left text-xs text-zinc-400 hover:text-zinc-100">
                      Add grant
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
