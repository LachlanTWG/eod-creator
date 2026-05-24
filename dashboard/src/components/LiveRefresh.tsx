"use client";

// Subscribes to Postgres realtime changes on `activities` and calls
// router.refresh() so the server component re-fetches + re-renders.
// Single subscription per page; RLS scopes which rows the user can see.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LiveRefresh({ fetchedAtIso }: { fetchedAtIso: string }) {
  const router = useRouter();
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("activities-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities" },
        () => {
          setLastEventAt(Date.now());
          router.refresh();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [router]);

  // Tick every 5s so the "updated Ns ago" indicator stays live without
  // hammering the DB.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  void tick;
  const fetchedAt = new Date(fetchedAtIso).getTime();
  const secondsAgo = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000));
  const label =
    secondsAgo < 60 ? `${secondsAgo}s ago`
    : secondsAgo < 3600 ? `${Math.floor(secondsAgo / 60)}m ago`
    : `${Math.floor(secondsAgo / 3600)}h ago`;

  const justUpdated = lastEventAt !== null && Date.now() - lastEventAt < 4000;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`relative flex h-2 w-2 ${
          justUpdated ? "" : ""
        }`}
        aria-hidden
      >
        <span
          className={`absolute inline-flex h-full w-full rounded-full ${
            justUpdated ? "animate-ping bg-emerald-400 opacity-75" : "bg-emerald-500/70"
          }`}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="text-zinc-500">
        Live · updated <span className="text-zinc-300">{label}</span>
      </span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="ml-2 rounded border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      >
        Refresh
      </button>
    </div>
  );
}
