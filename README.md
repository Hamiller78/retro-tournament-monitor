# Retromania

A local-network retro tournament monitor. Tournament creation, participant and stage setup, and the two-station game wheels are available. Result entry, rankings, and tournament progression are not implemented yet.

## Run locally

Install Node.js 24 or later, then run `npm install` and `npm run dev`. Open the Vite address shown in the terminal on the host. Other devices on the same network can use the host computer's local IP address and port 5173; allow that port through the host firewall if needed. The server listens on port 3000 and stores its SQLite database under `data/`.

For a single-server build, run `npm run build` then `npm start` and open port 3000. Both the host and other local-network devices can use it. The database location can be changed with `RETROMANIA_DB_PATH`, and the server port with `PORT`.

Run `npm test` for unit tests and `npm run test:e2e` for the browser test (install a Playwright Chromium browser with `npx playwright install chromium` if needed).

See [docs](docs/README.md) for the specifications and implementation plan.

The administrator PIN protects setup changes, but the current local HTTP connection does not encrypt the PIN or tournament data on the network. Use it only on a trusted home network. Administrator sessions end when the browser session or server ends.
