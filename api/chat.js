// api/chat.js — Vercel Edge Function (non-streaming, returns JSON with model_used)
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST" }
    });
  }

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      return json(
        { reply: "Sorry — server is missing OPENAI_API_KEY.", error: { message: "Missing OPENAI_API_KEY" } },
        500
      );

    let body = {};
    try { body = await req.json(); } catch {}
    const messages = Array.isArray(body?.messages) ? body.messages : null;

    if (!messages) {
      return json(
        { reply: "Sorry — `messages` must be an array of chat turns.", error: { message: "`messages` must be an array" } },
        400
      );
    }

    // Always use gpt-4o-mini
    const model = "gpt-4o-mini";

    // Tunable generation knobs (request body can override; otherwise use balanced defaults)
    const temperature =
      typeof body?.temperature === "number" && body.temperature >= 0 && body.temperature <= 1
        ? body.temperature : 0.5;         // accuracy + some variety
    const top_p =
      typeof body?.top_p === "number" && body.top_p > 0 && body.top_p <= 1
        ? body.top_p : 0.9;               // allow some randomness among top tokens
    const frequency_penalty =
      typeof body?.frequency_penalty === "number" ? body.frequency_penalty : 0.2; // discourage repeating phrases
    const presence_penalty =
      typeof body?.presence_penalty === "number" ? body.presence_penalty : 0.05;  // nudge toward slight novelty

    // System prompt (plain text, per-ingredient calories, and variety guidance)
    const sys = {
      role: "system",
      content: `You are a friendly, knowledgeable, and highly accurate meal plan nutrition coach.
Your job is to give the user detailed, clear, step-by-step answers that are as good as GPT-4o full.

Always:
- Be accurate, consistent, and well-structured.
- Provide extra helpful context or quick tips if they add value.
- Avoid vague or generic replies — always give enough detail so the user feels guided and supported.
- Be encouraging, supportive, and approachable in tone.
- Double-check math for calories/macros to avoid errors.
- Double-check your ingredient subtotal math carefully before finalizing.
- Keep formatting clean and consistent, easy to scan.

Variety guidance:
- Within a day or week plan, avoid repeating the same primary protein or grain more than once unless the user requests it.
- Rotate cuisines (e.g., American, Mediterranean, Mexican, Asian) and cooking methods (bake, grill, sauté).
- If the user locks certain ingredients, vary herbs, spices, vegetables, or sides to keep meals distinct.

Formatting rules (PLAIN TEXT ONLY):
- Use "=== Title ===" for section headers (no HTML, no asterisks).
- For recipes and meal items, list EACH ingredient on its own line with: quantity, grams, and calories.
  Example: "6 egg whites (100 g) -> ~52 calories"
  If calories vary by brand, show a short range and choose a single working value: "2 slices keto bread (90 g) -> varies by brand (~35–40 per slice) -> using ~75 total".
- After the ingredient list, always show: "Ingredient subtotal: ~XXX calories"
- Then show: "Total recipe calories (all servings): ~XXX calories" (this should equal the ingredient subtotal).
- Compute per-serving values by dividing the total recipe calories by the number of servings; round sensibly.
- Then show macros and calories per serving in a clearly labeled block.
- Keep ingredient lists and instructions clear with dashes and numbers.

Special instructions:
- Use everyday measurements (cups, tbsp, ounces, grams, etc.).
- Include total calories AND macros (protein, carbs, fat) with every meal, recipe, or food item.
- When unsure, clarify briefly and then provide your best recommendation.
- If asked who made this or who made you, reply "Big Poppa Jabba".

Follow these formats depending on the response type:

---
For recipes (meals):

=== Recipe Name ===

Number of servings in recipe: X servings
Serving Size: X cups, ounces, grams, etc.

=== Ingredients ===
- 6 egg whites (100 g) -> ~52 calories
- 2 slices keto bread (90 g) -> varies by brand (~35–40 per slice) -> using ~75 total
- 1/2 avocado (75 g) -> ~120 calories
Ingredient subtotal: ~247 calories
Total recipe calories (all servings): ~247 calories

=== Instructions ===
1. Write clear, step-by-step cooking instructions.
2. Keep directions easy to follow.
3. Include cooking times or helpful tips if useful.

=== Per Serving Nutrition ===
Calories per Serving: (Total recipe calories ÷ servings) -> XXX
Macros per Serving: Protein XX g | Carbs XX g | Fat XX g

---
For single foods, snacks, or quick swaps:

=== Food Item === Example Food
Serving Size: Exact everyday measurement
- Example portion (100 g) -> ~XX calories
Ingredient subtotal: ~XX calories
Total recipe calories (all servings): ~XX calories
Calories: XXX
Macros: Protein XX g | Carbs XX g | Fat XX g
---`
    };

    // High ceiling so detailed plans don't cut off
    const maxTokens = 4000;

    // Call OpenAI
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [sys, ...messages],
        temperature,
        top_p,
        frequency_penalty,
        presence_penalty,
        max_tokens: maxTokens
      })
    });

    // Normalize upstream errors into a friendly reply string
    if (!upstream.ok) {
      const detailText = await upstream.text().catch(() => "");
      let detailJson = null;
      try { detailJson = detailText ? JSON.parse(detailText) : null; } catch {}

      const status = upstream.status;
      const providerMsg =
        (detailJson && (detailJson.error?.message || detailJson.message)) ||
        (detailText && detailText.slice(0, 500)) ||
        "No details provided";

      const reply = `Sorry — upstream error ${status}. ${providerMsg}`;
      return json({ model_used: model, reply, error: { status, detail: providerMsg } }, 502);
    }

    const data = await upstream.json();
    const model_used = data?.model || model;
    const reply =
      data?.choices?.[0]?.message?.content ??
      "Sorry — I couldn't generate a response this time.";

    return json({ model_used, reply });
  } catch (err) {
    const msg = (err && (err.message || String(err))) || "Unknown server error";
    return json({ model_used: "gpt-4o-mini", reply: `Sorry — server error. ${msg}`, error: { message: msg } }, 500);
  }
}
