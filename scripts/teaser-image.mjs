// Renders the pre-launch teaser image (1200x675, no URL) from the site's own look:
// navy ground, the P mark, a headline, and the loan ticket with the debt going down.
//   node scripts/teaser-image.mjs [out.png] [headline|line 2]
import sharp from "sharp";
import { readFileSync } from "node:fs";

const out = process.argv[2] ?? "teaser.png";
const [h1a, h1b] = (process.argv[3] ?? "a loan strangers|pay for.").split("|");
const mark = readFileSync(new URL("../public/mark-c.png", import.meta.url)).toString("base64");

const W = 1200, H = 675;
const ice = "#b9cdff", ink = "#f2f6ff", mute = "#9fb0d8", faint = "#6f80a8", red = "#ff8a70", deep = "#13275e", paper = "#0a1636";
const mono = "Consolas, 'Cascadia Mono', monospace", disp = "'Segoe UI', Arial, sans-serif";

const fees = [["09:12", "0.84"], ["10:41", "1.12"], ["12:03", "0.67"], ["13:55", "1.38"], ["15:20", "0.91"], ["16:02", "1.05"]];
const feeRows = fees.map(([t, a], i) => `<text x="0" y="${i * 24}" font-family="${mono}" font-size="13" fill="${faint}">${t}</text><text x="70" y="${i * 24}" font-family="${mono}" font-size="13" fill="${faint}">pool fee</text><text x="330" y="${i * 24}" font-family="${mono}" font-size="13" fill="${ice}" text-anchor="end">−${a}</text>`).join("");

const grid = Array.from({ length: 30 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}" stroke="${ice}" stroke-opacity=".045"/>`).join("") +
  Array.from({ length: 17 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}" stroke="${ice}" stroke-opacity=".045"/>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="78%" cy="45%" r="55%"><stop offset="0" stop-color="#2f5bd6" stop-opacity=".45"/><stop offset="1" stop-color="#2f5bd6" stop-opacity="0"/></radialGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${paper}"/><stop offset="1" stop-color="#071130"/></linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050a1c"/><stop offset="1" stop-color="#07112e"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${grid}
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- brand -->
  <image href="data:image/png;base64,${mark}" x="56" y="44" width="64" height="64"/>
  <text x="130" y="90" font-family="${disp}" font-weight="700" font-size="30" fill="${ink}" letter-spacing="1">PAYOFF</text>
  <text x="56" y="140" font-family="${mono}" font-size="13" fill="${faint}" letter-spacing="3">SELF-REPAYING LOANS · ROBINHOOD CHAIN</text>

  <!-- headline -->
  <text x="56" y="300" font-family="${disp}" font-weight="700" font-size="76" fill="${ink}" letter-spacing="-2">${h1a}</text>
  <text x="56" y="384" font-family="${disp}" font-weight="700" font-size="76" fill="${ice}" letter-spacing="-2">${h1b}</text>
  <text x="56" y="440" font-family="${disp}" font-size="22" fill="${mute}">every NVDA trade on chain pays your debt down.</text>
  <text x="56" y="472" font-family="${disp}" font-size="22" fill="${mute}">you keep the shares.</text>

  <rect x="56" y="560" width="200" height="44" rx="22" fill="none" stroke="${ice}" stroke-opacity=".45" stroke-dasharray="4 4"/>
  <text x="156" y="588" font-family="${mono}" font-size="14" fill="${ice}" text-anchor="middle" letter-spacing="3">COMING THIS WEEK</text>

  <!-- ticket -->
  <g transform="translate(720 92) rotate(-1.5)">
    <rect x="14" y="14" width="420" height="500" rx="10" fill="${deep}"/>
    <rect x="0" y="0" width="420" height="500" rx="10" fill="url(#card)" stroke="rgba(170,196,255,.4)"/>
    <rect x="330" y="0" width="44" height="12" rx="0" fill="#050a1c" stroke="rgba(170,196,255,.3)"/>
    <g transform="translate(22 30)">
      <text x="0" y="0" font-family="${mono}" font-size="11" fill="${faint}" letter-spacing="2">PAYOFF · LOAN STATEMENT</text>
      <text x="376" y="0" font-family="${mono}" font-size="11" fill="${faint}" letter-spacing="2" text-anchor="end">NO. 0001</text>
      <line x1="0" y1="14" x2="376" y2="14" stroke="${ice}" stroke-opacity=".25"/>
      ${["DEPOSITED", "BORROWED", "EARNING", "REPAID"].map((s, i) => `<line x1="${i * 96}" y1="30" x2="${i * 96 + 88}" y2="30" stroke="${i < 3 ? ice : faint}" stroke-opacity="${i < 3 ? 1 : .3}" stroke-width="2"/><text x="${i * 96}" y="48" font-family="${mono}" font-size="10" fill="${i < 3 ? ice : faint}" letter-spacing="1.5">${s}</text>`).join("")}
      <g transform="translate(0 84)" font-family="${mono}">
        <text x="0" y="0" font-size="10" fill="${faint}" letter-spacing="2">TICKER</text><text x="376" y="0" font-size="14" fill="${ink}" text-anchor="end">NVDA</text>
        <line x1="0" y1="12" x2="376" y2="12" stroke="${ice}" stroke-opacity=".12"/>
        <text x="0" y="36" font-size="10" fill="${faint}" letter-spacing="2">COLLATERAL</text><text x="376" y="36" font-size="14" fill="${ink}" text-anchor="end">10.00 <tspan fill="${faint}" font-size="10">@ $218.30</tspan></text>
        <line x1="0" y1="48" x2="376" y2="48" stroke="${ice}" stroke-opacity=".12"/>
        <text x="0" y="72" font-size="10" fill="${faint}" letter-spacing="2">BORROWED</text><text x="376" y="72" font-size="14" fill="${ink}" text-anchor="end">$982 USDG</text>
        <line x1="0" y1="84" x2="376" y2="84" stroke="${ice}" stroke-opacity=".12"/>
        <text x="0" y="108" font-size="10" fill="${faint}" letter-spacing="2">PAID BY YOU</text><text x="376" y="108" font-size="14" fill="${ink}" text-anchor="end">$0.00</text>
        <line x1="0" y1="120" x2="376" y2="120" stroke="${ice}" stroke-opacity=".12"/>
        <text x="0" y="146" font-size="10" fill="${faint}" letter-spacing="2">DEBT NOW</text>
        <text x="200" y="146" font-size="12" fill="${faint}" text-anchor="end" text-decoration="line-through">$982.00</text>
        <text x="280" y="146" font-size="12" fill="${faint}" text-anchor="end" text-decoration="line-through">$946.10</text>
        <text x="376" y="147" font-size="18" fill="${red}" text-anchor="end" font-weight="700">$911.42</text>
        <line x1="0" y1="160" x2="376" y2="160" stroke="${ice}" stroke-opacity=".25"/>
      </g>
      <text x="0" y="272" font-family="${mono}" font-size="10" fill="${faint}" letter-spacing="2">FEES COLLECTED</text>
      <text x="376" y="272" font-family="${mono}" font-size="10" fill="${faint}" letter-spacing="2" text-anchor="end">USDG → DEBT</text>
      <g transform="translate(0 298)">${feeRows}</g>
      <line x1="0" y1="440" x2="376" y2="440" stroke="${ice}" stroke-opacity=".25"/>
      <text x="188" y="460" font-family="${mono}" font-size="9.5" fill="${faint}" text-anchor="middle" letter-spacing="2">PAID BY 1,204 TRADES · NONE OF THEM YOURS</text>
    </g>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote", out);
