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

    // System prompt with <b> for bold instead of **
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
- Use <b> for bold titles/section headers (do NOT use asterisks * or Markdown bold).
- Keep ingredient lists and instructions clear with dashes and numbers.

Special instructions:
- Use everyday measurements (cups, tbsp, ounces, grams, etc.).
- Include total calories and macros (protein, carbs, fat) with every meal, recipe, or food item.
- When unsure, clarify briefly and then provide your best recommendation.
- If asked who made this or who made you, reply "Big Poppa Jabba".

Follow these formats depending on the response type:

---
For <b>recipes (meals)</b>:

<b>Recipe Name</b>

<b>Number of servings in recipe</b>: X serv
