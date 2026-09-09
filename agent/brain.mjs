/**
 * Optional Claude review of a plan. The rules decide; the model may only VETO an action
 * it thinks is unsafe and say why. It cannot add actions, change amounts or pick markets,
 * so the worst a bad answer can do is delay something the rules wanted. Without an API
 * key the runner executes the plan as-is.
 */

const MODEL = process.env.AGENT_MODEL ?? "claude-sonnet-5";

export function hasModel() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function review(plan) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const summary = {
    ltv: plan.ltv,
    actions: plan.actions.map((a) => ({ kind: a.kind, reason: a.reason, description: a.built.tx.description, notes: a.built.notes ?? [] })),
    skipped: plan.skipped,
  };
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You review the planned on-chain actions of a self-repaying loan agent on Robinhood Chain (Morpho Blue debt, Uniswap V3 liquidity). " +
      "The rules already decided; you may only veto an action that looks unsafe or self-defeating (for example: opening liquidity when a close was just triggered, refinancing for a trivial saving with a thin market, protecting when LTV is far from the trigger). " +
      "Reply with JSON only: {\"veto\": [kinds to veto], \"note\": \"one sentence\"}. An empty veto list means proceed.",
    messages: [{ role: "user", content: JSON.stringify(summary) }],
  });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { veto: [], note: "unparseable review; proceeding" };
  try {
    const parsed = JSON.parse(m[0]);
    return { veto: Array.isArray(parsed.veto) ? parsed.veto.map(String) : [], note: String(parsed.note ?? "") };
  } catch {
    return { veto: [], note: "unparseable review; proceeding" };
  }
}
