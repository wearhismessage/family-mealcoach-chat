// api/chat.js — Edge function, hardcodes gpt-4o, clear JSON errors
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const json = (obj, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
    });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "Missing OPENAI_API_KEY in server environment." }, 500);

    // Parse request body
    let body = {};
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

    const { messages } = body || {};
    if (!Array.isArray(messages)) return json({ error: "`messages` must be an array of chat turns." }, 400);

    // For now, always use gpt-4o (remove hardcode later if you want model switching)
    const chosen = "gpt-4o";

    const sys = {
      role: "system",
      content:
        "You are a supportive, practical nutrition coach. Help the user plan meals that meet daily calorie and macro goals. Use common, affordable foods; provide swaps and grocery tips; ask brief clarifying questions only when truly necessary."
    };

    // Upstream call (SSE)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: chosen, stream: true, temperature: 0.7, messages: [sys, ...messages] })
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await readAsText(upstream).catch(() => "");
      const hint =
        upstream.status === 401
          ? "OpenAI says Unauthorized (bad/missing key). Check OPENAI_API_KEY."
          : upstream.status === 404
          ? "OpenAI says Not Found (model unavailable)."
          : `OpenAI upstream error (${upstream.status}).`;
      return json({ error: hint, status: upstream.status, detail }, 502, { "X-Model-Used": chosen });
    }

    // Stream through
    const headers = new Headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Model-Used": chosen
    });
    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    return json({ error: "Server error.", detail: String(err?.message || err) }, 500);
  }
}

async function readAsText(resp) {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await resp.json();
    return JSON.stringify(j);
  }
  return await resp.text();
}
