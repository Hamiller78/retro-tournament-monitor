# Station view — draft

This proposed screen and interaction applies the [play workflow](play-workflow.md) to one station. It is for review, not a final visual design.

## What the screen shows

- The station and its selected game, result format, and number of attempts.
- A participant table showing names, recorded attempts, best results, and current game ranking, adapted to the device.
- A clearly identified active player and an easy way to enter their next result.
- A way to view the combined leaderboard without losing track of the active player. Monitor views can also show who is now playing at each station.
- Clear indications of preliminary standings and a disconnected device.

## Typical use

1. Select a player from the table who has an attempt without a result.
2. The player plays. The selection remains available while people browse the ranking; the app does not hold them in an input dialog.
3. When the attempt is finished, enter and submit the score or time for the active player without an administrator PIN.
4. The table, game ranking, points, and combined leaderboard update. Select another player or enter another pending attempt.

An administrator can edit or delete an entered result while the stage is open. If a connection is lost during entry, the value stays visible so it can be submitted after reconnection. Detailed offline behavior remains open.

Each station has one active player at a time. The table is normally sorted by game ranking; players who have not played can be found by scrolling down. A device locks a station for result entry so another device cannot enter results for that station simultaneously. Other devices can still view the station. A brief connection interruption does not immediately release the lock, allowing the device to reconnect and continue. If a device crashes or disappears, an administrator can release the lock using the PIN and assign another device. The original device cannot submit under the old lock if it later returns.


The interface, visual style, and exact controls are still open.
