// api/chat.js — Vercel Edge Function, robust errors + optional password
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

    const famSecret = process.env.FAMILY_SECRET || null;

    // Parse request body (Edge runtime Web API)
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const { messages, model } = body || {};
    if (!Array.isArray(messages)) return json({ error: "`messages` must be an array of chat turns." }, 400);

    // Optional family password check
    if (famSecret) {
      const provided = req.headers.get("x-family-secret") || "";
      if (provided !== famSecret) {
        return json({ error: "Unauthorized: wrong or missing family password." }, 401);
      }
    }

    // Default to gpt-4o; disable gpt-5 for now (change later when your key has access)
    const requested = model || "gpt-4o";
    const chosen = requested === "gpt-5" ? "gpt-4o" : requested;

    const sys = {
      role: "system",
      content:
        "You are a supportive, practical nutrition coach. Help the user plan meals that meet daily calorie and macro goals. Use common, affordable foods; provide swaps and grocery tips; ask brief clarifying questions only when truly necessary."
    };

    // Upstream call (SSE)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: chosen, stream: true, temperature: 0.7, messages: [sys, ...messages] })
    });

    if (!upstream.ok || !upstream.body) {
      const detailText = await readAsText(upstream).catch(() => "");
      const msg =
        upstream.status === 401
          ? "OpenAI says Unauthorized (bad or missing API key)."
          : upstream.status === 404
          ? "OpenAI says Not Found (model not available to your key)."
          : "OpenAI upstream error.";
      return json({ error: msg, status: upstream.status, detail: detailText }, 502);
    }

    // Stream through to client with info header
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
