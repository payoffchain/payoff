"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap" style={{ padding: 80 }}>
      <span className="eyebrow">Error</span>
      <h2>Something broke on this page.</h2>
      <p className="note bad" style={{ marginTop: 16 }}>{error.message}</p>
      <p className="row" style={{ marginTop: 20 }}><button className="btn" onClick={reset}>Try again</button></p>
    </main>
  );
}
