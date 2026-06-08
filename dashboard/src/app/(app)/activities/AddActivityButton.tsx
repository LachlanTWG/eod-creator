"use client";

// "Add activity" header button + drawer. Thin client wrapper so the server
// component page can stay server-rendered.

import { useState } from "react";
import { AddActivityDrawer, type CompanyOption, type SalesPersonOption } from "./AddActivityDrawer";

export function AddActivityButton({
  companies,
  salesPeople,
  isAdmin,
  mySalesPersonIds,
  defaultDate,
}: {
  companies: CompanyOption[];
  salesPeople: SalesPersonOption[];
  isAdmin: boolean;
  mySalesPersonIds: string[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);

  if (companies.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
      >
        + Add activity
      </button>
      {open && (
        <AddActivityDrawer
          onClose={() => setOpen(false)}
          companies={companies}
          salesPeople={salesPeople}
          isAdmin={isAdmin}
          mySalesPersonIds={mySalesPersonIds}
          defaultDate={defaultDate}
        />
      )}
    </>
  );
}
