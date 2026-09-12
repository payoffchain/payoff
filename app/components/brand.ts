/** One place to rename the product. */
export const APP = process.env.NEXT_PUBLIC_APP_NAME ?? "PAYOFF";
export const TAGLINE = "Self-repaying loans on Robinhood Chain";
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://payoff.example";
export const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Robinhood Chain";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
export const FACTORY = process.env.NEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS ?? "";
export const TWITTER = process.env.NEXT_PUBLIC_TWITTER_URL ?? "";
/** The auto-repay key PAYOFF runs itself (Railway service). Empty = self-run only. */
export const HOSTED_OPERATOR = process.env.NEXT_PUBLIC_PAYOFF_OPERATOR ?? "";
export const HOSTED_STATUS_URL = (process.env.NEXT_PUBLIC_PAYOFF_OPERATOR_STATUS_URL ?? "").replace(/\/$/, "");
