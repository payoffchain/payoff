import { NextResponse } from "next/server";
import { handler } from "@/lib/http";
import { leaderboard } from "@/lib/services/leaderboard";

export const runtime = "nodejs";

/** GET /api/leaderboard -> vaults ranked by debt repaid from fees, plus protocol totals */
export const GET = handler("leaderboard", async () => NextResponse.json(await leaderboard()));
