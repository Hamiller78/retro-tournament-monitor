# Retromania working guidelines

- Treat `docs/` as the source of truth for agreed requirements and decisions. Record open questions separately from decisions; do not invent tournament rules.
- Work with the user on specifications in manageable steps before implementing features. Keep the design understandable and avoid unnecessary abstraction.
- Use strict TypeScript throughout: React and Vite for the client, Node.js and Fastify for the server, SQLite for persistence, WebSockets for live updates, and Tailwind CSS for styling.
- Aim for a small TypeScript monorepo with `client/`, `server/`, and `shared/` for shared types and API contracts. Prefer one server over microservices.
- Keep tournament rules separate from presentation and infrastructure. The server owns authoritative state and database access; clients interact with it over the network.
- Write appropriate automated tests alongside implementation: Vitest for unit tests and Playwright for browser tests. Verify changes at the level their risk warrants.
- Do not scaffold application code until the user is ready to move from specification to implementation.
