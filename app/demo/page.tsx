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
        <h2>From an idle stock token to a loan that pays itself, in under a minute.</h2>
        <p className="lede">Eight steps: connect, pick a market, set the policy, make the operator key, create and fund the vault, then watch the agent deploy, harvest and hop. Space pauses, arrow keys step.</p>
        <div style={{ marginTop: 32 }}><DemoPlayer /></div>
        <div className="grid g3" style={{ marginTop: 40 }}>
          <div className="card"><h3>What you sign</h3><p>Create vault, deposit collateral, borrow. Everything after that is the operator key's job, inside the policy you set.</p></div>
          <div className="card"><h3>What the agent does</h3><p>Deploys idle USDG into the pair's pool, harvests fees onto the debt, refinances into cheaper allow-listed markets, and repays early at your trigger.</p></div>
          <div className="card"><h3>What nobody can do</h3><p>Send a token out of the vault to any address but yours. Not the agent, not {APP}, not a leaked key.</p></div>
        </div>
        <p className="row" style={{ marginTop: 32 }}><Link className="btn coral lg" href="/deploy">Deploy an agent →</Link><Link className="btn lg" href="/docs">Read the docs</Link></p>
      </main>
    </>
  );
}
