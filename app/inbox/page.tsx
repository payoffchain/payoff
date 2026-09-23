"use client";

import { useEffect, useState } from "react";

type Msg = { id: string; at: string; name: string; contact: string; message: string; hidden?: boolean };

/**
 * Team reader for the holding page's messages: everything, including the private contact
 * field, with a switch to take a message off the public wall. Open with /inbox?key=<INBOX_READ_KEY>.
 */
export default function Inbox() {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load(k: string) {
    setErr(null);
    try {
      const r = await fetch(`/api/feedback?key=${encodeURIComponent(k)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not load");
      setMsgs(j.messages);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not load");
    }
  }

  async function toggle(m: Msg) {
    setBusy(m.id);
    try {
      const r = await fetch(`/api/feedback/hide?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: m.id, hidden: !m.hidden }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "could not update");
      setMsgs((xs) => xs && xs.map((x) => (x.id === m.id ? { ...x, hidden: !m.hidden } : x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not update");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("key") ?? "";
    setKey(k);
    if (k) load(k);
  }, []);

  return (
    <main className="wrap" style={{ padding: "48px 24px 80px", maxWidth: 820 }}>
      <span className="eyebrow">Inbox</span>
      <h2>Messages from visitors.</h2>
      {!key && <p className="note">Open this page with ?key= and the inbox read key.</p>}
      {err && <p className="note bad">{err}</p>}
      {msgs && (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            <span className="faint mono" style={{ fontSize: 12 }}>{msgs.length} message{msgs.length === 1 ? "" : "s"} · {msgs.filter((m) => m.hidden).length} hidden from the wall</span>
            <button className="btn xs" onClick={() => load(key)}>Refresh</button>
          </div>
          {msgs.length === 0 && <p className="note" style={{ marginTop: 14 }}>No messages yet.</p>}
          {msgs.map((m) => (
            <div className="card" key={m.id} style={{ marginTop: 12, opacity: m.hidden ? 0.55 : 1 }}>
              <div className="row faint mono" style={{ fontSize: 12, justifyContent: "space-between" }}>
                <span>{m.name || "anonymous"}{m.contact ? ` · ${m.contact}` : ""}{m.hidden ? " · hidden" : ""}</span>
                <span>{new Date(m.at).toLocaleString("en-US")}</span>
              </div>
              <p style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.message}</p>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn xs" disabled={busy === m.id} onClick={() => toggle(m)}>{m.hidden ? "Show on the wall" : "Hide from the wall"}</button>
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
