# Combined monitor view — draft

This is a proposed presentation view for review. It uses the [tournament decisions](tournament-domain.md) and [play workflow](play-workflow.md); layout and visual style are not fixed.

## During the initial stage

The monitor presents the combined leaderboard prominently, making use of the available screen. Each participant has a display name, position, points from each station, and combined points. Tied positions follow the agreed ranking rules. Forfeited or withdrawn participants remain visible below active participants and are marked accordingly. While results remain pending, the standings are clearly marked preliminary and update as results change. A station with no result yet shows a dash rather than zero points.

A compact section for each station shows its selected game and the active player as “Now playing,” when one is selected. The monitor is intended for spectators and does not need result-entry controls. If a station has not yet confirmed its game or has no active player, its section should communicate that state clearly.

## Progression

Once the initial stage is complete, the monitor can show its final standings and who advances. If a tie-breaker is required, it can show the tied players and the result. Later, it can show the multiplayer elimination order and the fighting final's current round wins, then the tournament winner. The viewer chooses which view to display by clicking. An optional follow-updates mode briefly highlights new results from another room while keeping the current view in place. The combined view shows results from both stations. Exactly which updates trigger a highlight remains open.

## Connection state

The monitor should make a lost connection visible and update after reconnection. The details of how it catches up are still to be specified.

The display should accommodate fewer than 20 participants where practical, adapting to the available screen. The overflow behavior for smaller displays or larger fields remains open.

## Questions for review

- How should the monitor handle more participants than fit on screen?
