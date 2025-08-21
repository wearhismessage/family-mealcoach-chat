// api/chat.js — Vercel Edge Function (great for SSE streaming)
export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json({ error: "Missing OPENAI_API_KEY in server environment." }, 500);
    }

    const familySecret = process.env.FAMILY_SECRET || null;

    // Parse body (Edge runtime uses Web API)
    const body = await req.json().catch(() => ({}));
    const { messages, model } = body || {};

    if (familySecret && req.headers.get("x-family-secret") !== familySecret) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (!Array.isArray(messages)) {
      return json({ error: "`messages` must be an array of chat turns." }, 400);
    }

    // Safer default: use a broadly available model first to rule out access issues.
    // You can change back to "gpt-5" once you confirm access on your key.
    const chosenModel = model || "gpt-4o";

    const sys = {
      role: "system",
      content:
        "You are a supportive, practical nutrition coach. Help the user plan meals that meet daily calorie and macro goals. Use common, affordable foods; provide swaps and grocery tips; ask brief clarifying questions only when truly necessary."
    };

    // Make upstream request to OpenAI (SSE)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: chosenModel,
        stream: true,
        temperature: 0.7,
        messages: [sys, ...messages]
      })
    });

    if (!upstream.ok || !upstream.body) {
      const detailText = await readAsText(upstream).catch(() => "");
      // Return a friendly JSON error to the client
      const hint =
        upstream.status === 401
          ? "Unauthorized. Check OPENAI_API_KEY on Vercel."
          : upstream.status === 404
          ? "Model not found/available to your key. Try gpt-4o or gpt-4o-mini."
          : "See Vercel logs for details.";
      return json({ error: "Upstream error from OpenAI.", status: upstream.status, hint, detail: detailText }, 502);
    }

    // Pass-through SSE stream to browser
    const resHeaders = new Headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    // In Edge runtime we can just return the upstream body directly
    return new Response(upstream.body, { status: 200, headers: resHeaders });
  } catch (err) {
    return json({ error: "Server error.", detail: String(err?.message || err) }, 500);
  }
}

// Helpers
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function readAsText(resp) {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await resp.json();
    return JSON.stringify(j);
  }
  return await resp.text();
}
