# survey-analysis

Production-quality Next.js app that digitizes paper/scanned surveys. Monorepo with a Next.js web app and (later) a Python worker for OCR/processing.

## Structure

- `web/` — Next.js 16 (App Router, TypeScript, Tailwind, shadcn/ui).
- `worker/` — Python worker for OCR and survey processing. Added in Phase 4.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in real values
pnpm --filter web prisma generate  # (once Prisma is added)
pnpm dev
```

The Next.js dev server runs on http://localhost:3000.

## Scripts (root)

- `pnpm dev` — run the web app in dev mode
- `pnpm build` — build the web app
- `pnpm lint` — lint the web app
- `pnpm typecheck` — type-check the web app

## Worker

The Python worker lives under `worker/` and will be added in Phase 4.
