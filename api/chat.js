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
    if (!apiKey) return json({ error: "Missing OPENAI_API_KEY in server environment." }, 500);

    let body = {};
    try { body = await req.json(); } catch {}
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    const requestedModel = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : null;

    if (!messages) return json({ error: "`messages` must be an array of chat turns." }, 400);

    // Default to gpt-4o (stable & widely available)
    const model = requestedModel || "gpt-4o";

// System prompt for nutrition coach
const sys = {
  role: "system",
  content: `You are a friendly, helpful meal plan nutrition coach.
Help the user plan meals that meet daily calorie and macro goals.
Use common, affordable foods; provide swaps and grocery tips; ask brief clarifying questions only when truly necessary.
Always give food measurements in everyday terms and measurements (tablespoons, cups, ounces, grams, etc.),
not just calorie amounts.
Always include total calories and macros (protein, carbs, fat) with each meal, such as breakfast, lunch, dinner, snacks.
Write in a supportive, encouraging tone, but keep the formatting consistent and easy to read.
Follow these formats exactly depending on the type of response:

---
For **recipes (meals)**, use this format:

**Recipe Name**

**Number of servings in recipe**: X servings
**Serving Size**: X cups, ounces, grams, etc.
**Calories per Serving**: XXX
**Macros per Serving**: Protein XXg | Carbs XXg | Fat XXg

**Ingredients**:
- List each ingredient with exact measurements (cups, tbsp, ounces, grams, etc.)

**Instructions**:
1. Write clear, step-by-step cooking instructions.
2. Keep directions easy to follow.
3. Include cooking times or helpful tips if useful.

---
For **single foods or snacks/quick swaps**, use this shorter format:

**Food Item**: Example Food
**Serving Size**: Exact everyday measurement
**Calories**: XXX
**Macros**: Protein XXg | Carbs XXg | Fat XXg
---`
};


    // Call OpenAI (non-streaming for simplicity)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [sys, ...messages],
        temperature: 0.7,
        // non-streaming (omit stream:true)
      })
    });

    if (!upstream.ok) {
      // Bubble up provider error detail to help debugging
      const detail = await upstream.text().catch(() => "");
      const friendly =
        upstream.status === 401
          ? "OpenAI says Unauthorized (bad/missing key)."
          : upstream.status === 404
          ? "OpenAI says Not Found (model unavailable for this key)."
          : `OpenAI upstream error (${upstream.status}).`;
      return json({ error: friendly, status: upstream.status, detail }, 502);
    }

    const data = await upstream.json();
    const model_used = data?.model || model;
    const reply =
      data?.choices?.[0]?.message?.content ??
      "Sorry — I couldn't generate a response this time.";

    return json({ model_used, reply });
  } catch (err) {
    return json({ error: "Server error.", detail: String(err?.message || err) }, 500);
  }
}
