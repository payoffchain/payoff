import Link from "next/link";
import Nav from "./components/Nav";

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: 80 }}>
        <span className="eyebrow">404</span>
        <h2>Nothing here.</h2>
        <p className="row" style={{ marginTop: 20 }}><Link className="btn" href="/">Home</Link><Link className="btn" href="/app">Dashboard</Link></p>
      </main>
    </>
  );
}
