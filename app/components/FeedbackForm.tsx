"use client";

import { useState } from "react";

/** The message box on the holding page. Posts to /api/feedback; the team reads them privately. */
export default function FeedbackForm() {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 2) return;
    setState("sending");
    setError(null);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || undefined, contact: contact || undefined, message, website: trap || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "something went wrong");
      setState("sent");
      setMessage("");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "something went wrong");
    }
  }

  if (state === "sent") {
    return <div className="fb-done">Thank you, we read every message. <button className="btn xs" onClick={() => setState("idle")}>Send another</button></div>;
  }

  return (
    <form className="fb" onSubmit={send}>
      <textarea placeholder="New X account, Telegram, Discord, something else? Tell us what you think" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={4} required />
      <div className="fb-row">
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <input placeholder="How to reach you (optional)" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={80} />
      </div>
      <input className="fb-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
      <button className="btn green" disabled={state === "sending" || message.trim().length < 2}>{state === "sending" ? "Sending…" : "Send message"}</button>
      {error && <p className="fb-err">{error}</p>}
      <p className="fb-note">Only the PAYOFF team can read these. We will never ask you for a private key or a seed phrase.</p>
    </form>
  );
}
