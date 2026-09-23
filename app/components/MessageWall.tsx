"use client";

import { useCallback, useEffect, useState } from "react";

type Msg = { id: string; at: string; name: string; message: string };

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** Everyone's messages from the holding page, newest first, refreshed every 20 seconds. */
export default function MessageWall({ refreshKey }: { refreshKey: number }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/feedback/public", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setMsgs(j.messages ?? []);
    } catch { /* keep what is shown */ }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => clearInterval(id);
  }, [load]);

  if (!msgs) return <div className="wall"><p className="wall-empty">Loading messages…</p></div>;
  return (
    <div className="wall">
      <div className="wall-head"><span>What people are saying</span><span>{msgs.length}</span></div>
      {msgs.length === 0 && <p className="wall-empty">No messages yet. Be the first.</p>}
      {msgs.map((m) => (
        <div className="wall-msg" key={m.id}>
          <div className="wall-meta"><b>{m.name}</b><span>{ago(m.at)}</span></div>
          <p>{m.message}</p>
        </div>
      ))}
    </div>
  );
}
