import Link from "next/link";
import Nav from "../components/Nav";
import DemoPlayer from "../components/DemoPlayer";
import { APP } from "../components/brand";

export const metadata = { title: "Demo" };

export default function Demo() {
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 80px" }}>
        <span className="eyebrow">Demo</span>
        <h2>From idle BTC to a loan that pays itself, in under a minute.</h2>
        <p className="lede">Eight steps: connect, pick your collateral, choose how careful to be, open the loan, deposit and borrow, then watch it put the USDC to work, collect fees onto the debt and move to a cheaper market. Space pauses, arrow keys step.</p>
        <div style={{ marginTop: 32 }}><DemoPlayer /></div>
        <div className="grid g3" style={{ marginTop: 40 }}>
          <div className="card"><h3>What you sign</h3><p>Create vault, deposit collateral, borrow. Everything after that is the operator key's job, inside the policy you set.</p></div>
          <div className="card"><h3>What auto-repay does</h3><p>Puts idle USDC into the collateral's pool, collects fees onto the debt, moves the debt to a cheaper market when there is one, and repays early at your safety line.</p></div>
          <div className="card"><h3>What nobody can do</h3><p>Send a token out of the vault to any address but yours. Not auto-repay, not {APP}, not a leaked key.</p></div>
        </div>
        <p className="row" style={{ marginTop: 32 }}><Link className="btn green lg" href="/borrow">Open a loan<span className="arr">→</span></Link><Link className="btn lg" href="/docs">Read the docs</Link></p>
      </main>
    </>
  );
}
