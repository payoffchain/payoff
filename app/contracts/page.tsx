import Link from "next/link";
import Nav from "../components/Nav";
import { APP, CHAIN_ID, CHAIN_NAME, FACTORY, HOSTED_OPERATOR, HOSTED_STATUS_URL, TOKEN_CA, TWITTER, TWITTER_HANDLE } from "../components/brand";
import { EXPLORER } from "../components/format";

export const metadata = { title: "Contracts", description: "Every official PAYOFF address in one place, with links to the verified code." };

/**
 * Every official address in one place. The point of the page is that anyone can check a
 * link, a contract or an account against it: if it is not listed here, it is not ours.
 */
const VAULT_IMPLEMENTATION = "0x8d9b9fBDF65b1AFCed5c5f275093e0884d816D61";
const TREASURY = "0x62e974a3EA812e8f0FCd1830E9f9B452F2625538";
const MORPHO = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";
const UNISWAP_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";

function Row({ label, address, note, code }: { label: string; address: string; note: string; code?: boolean }) {
  if (!address) return null;
  return (
    <div className="kv" style={{ alignItems: "flex-start", gap: 16 }}>
      <span style={{ minWidth: 190 }}>{label}<br /><span className="faint" style={{ fontSize: 12 }}>{note}</span></span>
      <b style={{ textAlign: "right", wordBreak: "break-all" }}>
        <a href={`${EXPLORER}/address/${address}${code ? "?tab=contract" : ""}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ textDecoration: "underline" }}>{address}</a>
        {code && <><br /><span className="pill g" style={{ marginTop: 6, display: "inline-block" }}>source verified</span></>}
      </b>
    </div>
  );
}

export default function Contracts() {
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 80px", maxWidth: 900 }}>
        <span className="eyebrow">Contracts · {CHAIN_NAME} · chain id {CHAIN_ID}</span>
        <h2>Every official address, in one place.</h2>
        <p className="lede">Check anything that claims to be {APP} against this page. If a contract, a token or an account is not listed here, it is not ours. Every link opens the block explorer, where the source code of our contracts is verified and readable.</p>

        <h3 style={{ marginTop: 36 }}>{APP} contracts</h3>
        <div className="card" style={{ marginTop: 10 }}>
          <Row label="Vault factory" address={FACTORY} code note="creates one vault per loan; cannot be upgraded" />
          <Row label="Vault implementation" address={VAULT_IMPLEMENTATION} code note="the code every vault runs; only the owner can withdraw" />
        </div>

        {TOKEN_CA && (
          <>
            <h3 style={{ marginTop: 32 }}>Token</h3>
            <div className="card" style={{ marginTop: 10 }}>
              <Row label="$PAYOFF" address={TOKEN_CA} note="the only one; anything else under our name is fake" />
            </div>
          </>
        )}

        <h3 style={{ marginTop: 32 }}>{APP} wallets</h3>
        <div className="card" style={{ marginTop: 10 }}>
          <Row label="Treasury" address={TREASURY} note="receives the protocol's share of harvested fees" />
          <Row label="Hosted auto-repay" address={HOSTED_OPERATOR} note="works on vaults that chose it; it can never withdraw" />
        </div>
        {HOSTED_STATUS_URL && <p className="mute" style={{ marginTop: 10, fontSize: 14 }}>Hosted auto-repay reports its status in public: <a href={`${HOSTED_STATUS_URL}/health`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{HOSTED_STATUS_URL.replace(/^https?:\/\//, "")}/health ↗</a></p>}

        <h3 style={{ marginTop: 32 }}>Protocols the vaults use</h3>
        <div className="card" style={{ marginTop: 10 }}>
          <Row label="Morpho Blue" address={MORPHO} note="where collateral sits and USDG is borrowed" />
          <Row label="Uniswap V3 position manager" address={POSITION_MANAGER} note="holds the vault's liquidity positions" />
          <Row label="Uniswap V3 swap router" address={SWAP_ROUTER} note="every swap is floored by the market oracle" />
          <Row label="Uniswap V3 factory" address={UNISWAP_FACTORY} note="where the pair's pools are looked up" />
        </div>
        <p className="mute" style={{ marginTop: 10, fontSize: 14 }}>A vault can send tokens to these protocol contracts, to the treasury within the fee caps written in its code, and to its owner. Nowhere else.</p>

        <h3 style={{ marginTop: 32 }}>Official links</h3>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="kv"><span>Website</span><b>payoffchain.tech</b></div>
          {TWITTER && <div className="kv"><span>X</span><b><a href={TWITTER} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{TWITTER_HANDLE}</a></b></div>}
        </div>
        <p className="mute" style={{ marginTop: 10, fontSize: 14 }}>We never send the first direct message, and we never ask for a private key or a seed phrase.</p>

        <p className="row" style={{ marginTop: 32 }}><Link className="btn green" href="/borrow">Open a loan</Link><Link className="btn" href="/docs">Read the docs</Link></p>
      </main>
    </>
  );
}
