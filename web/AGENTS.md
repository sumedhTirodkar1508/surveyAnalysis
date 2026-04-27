<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


# Project Architecture & Knowledge Graph
- This project uses a Knowledge Graph located in `/graphify-out/`.
- RULE: Before creating new routes, modifying the Prisma schema, or changing Worker-Web communication, ALWAYS consult `nodes.json` and `edges.json` in the graph folder to ensure alignment with existing dependencies.
- This is a dual-stack project: Next.js (Frontend/API) and Python (Worker). Coordination happens via Supabase Postgres and the pg-boss queue.