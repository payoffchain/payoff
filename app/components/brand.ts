/** One place to rename the product. */
export const APP = process.env.NEXT_PUBLIC_APP_NAME ?? "PAYOFF";
export const TAGLINE = "Self-repaying loans on Robinhood Chain";
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://usepayoff.xyz";
export const SITE_HOST = SITE.replace(/^https?:\/\//, "");
export const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Robinhood Chain";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
export const FACTORY = process.env.NEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS ?? "";
export const TWITTER = process.env.NEXT_PUBLIC_TWITTER_URL || "https://x.com/payoffchain_";
export const TWITTER_HANDLE = "@" + TWITTER.replace(/\/$/, "").split("/").pop();
/** The token contract address. Empty until launch: the nav shows "CA · soon". */
export const TOKEN_CA = process.env.NEXT_PUBLIC_TOKEN_CA ?? "";
/** The auto-repay key PAYOFF runs itself (Railway service). Empty = self-run only. */
export const HOSTED_OPERATOR = process.env.NEXT_PUBLIC_PAYOFF_OPERATOR ?? "";
export const HOSTED_STATUS_URL = (process.env.NEXT_PUBLIC_PAYOFF_OPERATOR_STATUS_URL ?? "").replace(/\/$/, "");
/** A real vault shown live in the hero ticket; empty = the worked example. */
export const FEATURED_VAULT = process.env.NEXT_PUBLIC_FEATURED_VAULT ?? "";
