# First implementation plan — draft

This is a proposed order for review, not authorization to start building. The [domain decisions](tournament-domain.md), [workflows](README.md), and [reliability requirements](reliability.md) describe the intended behavior.

## 1. Foundation

Set up the agreed TypeScript monorepo, client, server, shared contracts, SQLite persistence, and test tools. Establish a minimal way to run the server and open the client from another device on the local network. Confirm it works on the intended host platform.

## 2. Tournament setup

Create and save an incomplete tournament; configure participants, stages, games, scoring, attempts, and administrator PIN. Reopen setup after a restart. Validate essential configuration and present warnings for issues requiring attention.

## 3. Initial stage

Implement the two station pools and animated selection wheels, confirmed selections, station sessions, active players, attempt entry, game rankings, and live combined standings. Support protected corrections, stage forfeits, and closing checks.

## 4. Advancement and later stages

Resolve advancement and conditional tie-breakers. Implement the multiplayer elimination and fighting duel formats, stage progression, reopening restrictions, and winner display.

## 5. Recovery and polish

Provide the agreed manual export and separate-copy restore, automatic local stage-close backups, reconnect behavior, and practical testing on the host and station devices. Refine the retro presentation and monitor views.

These steps are suggested milestones, not isolated delivery guarantees: persistence, access control, live updates, and relevant tests belong alongside the features that need them. Backup and recovery should be introduced early enough to protect real tournament data. The first version should be tested end to end before relying on it at an event.

## Scope and remaining decisions

Exact implementation slices, stage-close backup retention, backup failure handling, connection recovery, and some stage-specific edge cases remain open. The model deliberately allows the final to use any suitable winner-determining format, while the first event needs a fighting duel. No application code has been scaffolded yet.
