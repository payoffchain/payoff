/**
 * A greyscale identicon for an address.
 *
 * The design system spends colour on exactly one thing (up vs down), so identity
 * cannot come from hue. It comes from shape instead: a 5×5 mirrored grid whose cells
 * are drawn from the address bytes in three lightnesses. Two owners are told apart at
 * a glance; nothing on the page gets a second palette.
 */
export default function Blockie({ address, size = 22 }: { address: string | null | undefined; size?: number }) {
  const cells = grid(address ?? "");
  const cell = size / 5;
  return (
    <svg className="blockie" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect width={size} height={size} fill="var(--paper-3)" />
      {cells.map((v, i) =>
        v === 0 ? null : (
          <rect
            key={i}
            x={(i % 5) * cell}
            y={Math.floor(i / 5) * cell}
            width={cell}
            height={cell}
            fill={v === 2 ? "var(--ink)" : "var(--rule-2)"}
          />
        )
      )}
    </svg>
  );
}

/** 25 cells, values 0/1/2, mirrored left-right so every blockie reads as a glyph. */
function grid(address: string): number[] {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const out = new Array(25).fill(0);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const nibble = parseInt(hex[(row * 3 + col) % hex.length], 16);
      const v = nibble < 6 ? 0 : nibble < 12 ? 1 : 2;
      out[row * 5 + col] = v;
      out[row * 5 + (4 - col)] = v;
    }
  }
  return out;
}
