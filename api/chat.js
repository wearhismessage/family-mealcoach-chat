// api/chat.js — Vercel Edge Function with auto-fallback from gpt-5 → gpt-4o
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "Missing OPENAI_API_KEY in server environment." }, 500);

    const body = await req.json().catch(() => ({}));
    const famSecret = process.env.FAMILY_SECRET || null;
    if (famSecret && req.headers.get("x-family-secret") !== famSecret) return json({ error: "Unauthorized" }, 401);

    const { messages, model } = body || {};
    if (!Array.isArray(messages)) return json({ error: "`messages` must be an array of chat turns." }, 400);

    const sys = {
      role: "system",
      content:
        "You are a supportive, practical nutrition coach. Help the user plan meals that meet daily calorie and macro goals. Use common, affordable foods; provide swaps and grocery tips; ask brief clarifying questions only when truly necessary."
    };

    // Try requested model first; if 404/403/401, fallback to gpt-4o
    const chosen = model || "gpt-4o";
    const first = await callOpenAI(apiKey, chosen, [sys, ...messages]);
    if (first.ok) return ssePassThrough(first);

    // Read error details
    const status = first.status;
    const detailText = await readAsText(first).catch(() => "");
    if (status === 404 || status === 401 || status === 403) {
      const second = await callOpenAI(apiKey, "gpt-4o", [sys, ...messages]);
      if (second.ok) {
        // Add a tiny hint header so front-end can show a toast if you want
        const headers = new Headers({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Model-Fallback": "gpt-4o"
        });
        return new Response(second.body, { status: 200, headers });
      }
      const d2 = await readAsText(second).catch(() => "");
      return json({ error: "OpenAI error (fallback also failed).", detail: d2 }, 502);
    }

    return json({ error: "OpenAI upstream error.", status, detail: detailText }, 502);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error.", detail: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}

function callOpenAI(apiKey, model, messages) {
  return fetch("https://platform.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true, temperature: 0.7, messages })
  });
}

function ssePassThrough(upstream) {
  const headers = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  return new Response(upstream.body, { status: 200, headers });
}

async function readAsText(resp) {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await resp.json();
    return JSON.stringify(j);
  }
  return await resp.text();
}
