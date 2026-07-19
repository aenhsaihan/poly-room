<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project orientation

Start with **ROADMAP.md** — it maps every project doc, records current
state, and holds the single authoritative backlog order. Before designing
or building anything, read the "Codebase invariants" section of VISION.md;
they are non-negotiable (attribution-by-column, derive-don't-store,
P&L-trailing, lazy-sync heartbeat, additive-only schema changes).

Environment constraints: no local Node toolchain (verify by review + push
+ watch the Vercel build); production is SSO-gated, so app API routes are
unreachable from the CLI — ask the user to open URLs in a logged-in
browser and paste the JSON.
