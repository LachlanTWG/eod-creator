"use client";

// Subscribes to the activities table via Supabase realtime. When any row
// changes, refresh the server-rendered page. Keeps the overview live without
// us hand-rolling deltas.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LiveBadge() {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("activities-overview")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities" },
        () => router.refresh(),
      )
      .subscribe(status => {
        if (status === "SUBSCRIBED") setStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("error");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  const dotClass =
    status === "live" ? "bg-emerald-500 animate-pulse" :
    status === "error" ? "bg-red-500" : "bg-zinc-500";

  const label = status === "live" ? "Live" : status === "error" ? "Offline" : "Connecting…";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}
