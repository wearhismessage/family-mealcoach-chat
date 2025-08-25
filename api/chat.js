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

    if (!messages) return json({ error: "`messages` must be an array of chat turns." }, 400);

    // Always use gpt-4o-mini
    const model = "gpt-4o-mini";

    // System prompt using === for section titles instead of <b> or **
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
- Keep formatting clean and consistent, easy to scan.

Formatting rule:
- Use "=== Title ===" for section headers instead of bold or asterisks.
- Keep ingredient lists and instructions clear with dashes and numbers.

Special instructions:
- Use everyday measurements (cups, tbsp, ounces, grams, etc.).
- Include total calories and macros (protein, carbs, fat) with every meal, recipe, or food item.
- When unsure, clarify briefly and then provide your best recommendation.
- If asked who made this or who made you, reply "Big Poppa Jabba".

Follow these formats depending on the response type:

---
For recipes (meals):

=== Recipe Name ===

Number of servings in recipe: X servings  
Serving Size: X cups, ounces, grams, etc.  
Calories per Serving: XXX  
Macros per Serving: Protein XXg | Carbs XXg | Fat XXg  

=== Ingredients ===
- List each ingredient with exact measurements  

=== Instructions ===
1. Write clear, step-by-step cooking instructions.  
2. Keep directions easy to follow.  
3. Include cooking times or helpful tips if useful.  

---
For single foods, snacks, or quick swaps:

=== Food Item === Example Food  
Serving Size: Exact everyday measurement  
Calories: XXX  
Macros: Protein XXg | Carbs XXg | Fat XXg  
---`
    };

    // Detect if user is asking for a recipe or meal plan
    const userInput = messages.map(m => m.content?.toLowerCase?.() || "").join(" ");
    let maxTokens = 800; // default = short Q&A

    if (userInput.includes("recipe") || userInput.includes("ingredients") || userInput.includes("instructions") || userInput.includes("how to cook")) {
      maxTokens = 1800; // more space for recipes
    }

    if (userInput.includes("meal plan") || userInput.includes("daily plan")) {
      maxTokens = 2500; // daily plans
    }

    if (userInput.includes("7-day") || userInput.includes("week") || userInput.includes("weekly")) {
      maxTokens = 3500; // weekly plans
    }

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
        temperature: 0.6,
        max_tokens: maxTokens
      })
    });

    if (!upstream.ok) {
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
