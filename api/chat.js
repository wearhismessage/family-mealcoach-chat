// api/chat.js
// Vercel Serverless Function that proxies to OpenAI with SSE streaming
// Default model: gpt-5 (standard). You can pass "gpt-5-mini" from the client.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // Optional: simple shared secret (set FAMILY_SECRET in Vercel env)
    const familySecret = process.env.FAMILY_SECRET || null;
    if (familySecret && req.headers["x-family-secret"] !== familySecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { messages, model = "gpt-5" } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "`messages` must be an array" });
    }

    // System prompt: a friendly, practical meal-planning coach
    const sys = {
      role: "system",
      content:
        "You are a supportive, practical nutrition coach. Help the user plan meals that meet daily calorie and macro goals. Use common, affordable foods; provide swaps and grocery tips; ask brief clarifying questions only when truly necessary."
    };

    // Call OpenAI Chat Completions with streaming
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,              // "gpt-5" by default (or "gpt-5-mini" from client)
        stream: true,
        temperature: 0.7,
        // Optional GPT-5 extras you can try later:
        // reasoning_effort: "minimal",
        // verbosity: "medium",
        messages: [sys, ...messages]
      })
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return res.status(502).json({ error: "Upstream error", detail });
    }

    // Forward the SSE stream to the browser
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = upstream.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(value); // pass-through SSE chunk bytes
    }

    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error" });
    } else {
      res.end();
    }
  }
}
