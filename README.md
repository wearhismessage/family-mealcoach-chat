# Family Meal Coach Chat (Vercel) — GPT-5

A minimal GPT-5 chat for family, with a nutrition-coach system prompt.

## Deploy

1) Create a new GitHub repo and upload this folder (drag-and-drop via **Add file → Upload files**).
2) In Vercel:
   - New Project → import the repo
   - Add Environment Variables:
     - `OPENAI_API_KEY` = your OpenAI key
     - (optional) `FAMILY_SECRET` = a shared password
3) Deploy. Visit your URL and start chatting.

## Local Dev (optional)

- Install Vercel CLI: `npm i -g vercel`
- Run: `vercel dev`
- Open: `http://localhost:3000`

## Notes

- API endpoint: `/api/chat` (serverless function with SSE)
- Frontend served from `/public/index.html`
- Switch models via the dropdown (gpt-5 / gpt-5-mini)
- If you set `FAMILY_SECRET`, enter it in the page header before sending messages.
