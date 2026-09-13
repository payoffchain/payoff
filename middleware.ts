import { NextResponse, type NextRequest } from "next/server";

/**
 * Site lock. With SITE_LOCKED=1 every page shows the holding page; the API keeps
 * answering so the hosted auto-repay runner is not affected. The team still gets in
 * by opening any URL with ?preview=<SITE_PREVIEW_KEY> once, which sets a cookie.
 */
const LOCKED = process.env.SITE_LOCKED === "1";
const KEY = process.env.SITE_PREVIEW_KEY ?? "";
const COOKIE = "payoff_preview";

export function middleware(req: NextRequest) {
  if (!LOCKED) return NextResponse.next();
  const url = req.nextUrl;
  if (url.pathname === "/soon") return NextResponse.next();

  const given = url.searchParams.get("preview");
  if (KEY && given === KEY) {
    const clean = url.clone();
    clean.searchParams.delete("preview");
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, KEY, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }
  if (KEY && req.cookies.get(COOKIE)?.value === KEY) return NextResponse.next();

  const soon = url.clone();
  soon.pathname = "/soon";
  soon.search = "";
  return NextResponse.rewrite(soon, { status: 200 });
}

export const config = {
  // pages only: the API, Next internals and static files stay open
  matcher: ["/((?!api/|_next/|icon\\.png|apple-icon\\.png|mark\\.png|mark-64\\.png|logo\\.png|favicon\\.ico|robots\\.txt).*)"],
};
