# Project and architecture

## Purpose

Retromania is intended to support a retro gaming tournament across multiple computers on a home network. It should support entering and displaying results, game-selection wheels, an overall leaderboard, and later tournament stages. The user wants a game-like presentation with a possible subtle retro pixel style and a format configurable for future tournaments.

Administration and presentation are different uses of the same tournament data. The design should account for unreliable Wi-Fi; agreed behavior and remaining questions are described in [reliability and recovery](reliability.md).

## Agreed stack

| Area | Technology |
| --- | --- |
| Language | TypeScript, strict mode |
| Client | React and Vite |
| Server | Node.js and Fastify |
| Persistence | SQLite |
| Live communication | WebSockets |
| Styling | Tailwind CSS |
| Unit testing | Vitest |
| Browser testing | Playwright |

## Principles

- Keep the architecture simple: one Node.js server, a browser client, and a SQLite database, without microservices or unnecessary frameworks.
- Plan a TypeScript monorepo with `client/`, `server/`, and `shared/` for tournament types and API contracts. This is an intended structure, not application scaffolding.
- The server owns authoritative state and accesses SQLite locally. Multiple clients communicate with the server rather than writing to a shared database file. The host may be Windows or Linux and can also run a browser client. The tournament pauses while the server is restarted after a crash.
- Separate tournament rules from UI and infrastructure so formats can evolve without hardcoding one event into the presentation.
- Specify requirements in `docs/`, implement in small steps, and add automated tests alongside features. The user reviews and tries the results.

## Still to decide

Deployment details, conflict handling, the limits of offline behavior, and the implementation details of administrator access and backup restoration remain to be specified. Tournament rules and workflows are documented separately under [docs](README.md).
