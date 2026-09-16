/** Small formatting helpers shared by the agent pages. */

export const usd = (n: number | null | undefined, digits = 0) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  // Anything that would round to zero is zero: never "-$0".
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const signedUsd = (n: number | null | undefined, digits = 0) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return (v >= 0 ? "+" : "") + usd(v, digits);
};

/**
 * A token amount that is never shown as "0" when it is not zero. Values from 0.01 up
 * use at most `maxDecimals` decimals; anything smaller is shown to three significant
 * digits (0.000000549), or in exponent form once the decimal string would be unreadable.
 */
export const amount = (v: string | number | null | undefined, maxDecimals = 4) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 0.01) return n.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
  if (abs < 1e-9) return "0"; // dust from rounding, not a balance anyone can use
  return n.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 20 });
};

export const short = (a: string | null | undefined) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");

export const ago = (unix: number | null | undefined) => {
  if (!unix) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const EXPLORER = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.arc.io").replace(/\/$/, "");
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

const LABELS_KEY = "payoff.vaultLabels";

export function readLabels(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LABELS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function writeLabel(agentId: string, label: string) {
  try {
    const all = readLabels();
    if (label.trim()) all[agentId] = label.trim();
    else delete all[agentId];
    localStorage.setItem(LABELS_KEY, JSON.stringify(all));
  } catch {
    // Storage may be unavailable (private mode); labels are a convenience only.
  }
}
