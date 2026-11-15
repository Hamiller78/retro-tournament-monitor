# Tournament play workflow — draft

This proposed sequence applies the [tournament decisions](tournament-domain.md) to the first event. It is for review, not a final screen design.

## 1. Start and draw games

After reviewing setup and resolving any blocking omissions, the organizer starts the tournament. Each station has its own animated wheel, showing its configured game pool. Anyone using the wheel view can spin, spin again, and confirm the chosen game without administrator access. Editing game pools remains an administrator action. If the second wheel selects the same game as the first, it can be spun again. The station is ready to collect results once its game is fixed.

## 2. Play at the stations

A device claims the station for result entry; other devices can still view it. A player is selected from the participant table for an attempt that has not yet received a result. It should then be easy to enter their score or time. The app must not be locked in an input dialog while they play: spectators can still check the ranking. No administrator login or approval is needed to submit a new result. The game settings determine how many attempts are required and whether a higher or lower value is better. A player who stops early can enter a dummy value for an unused attempt.

An administrator can correct or delete an entered result while the stage is open. Deleting a result makes that attempt pending and can allow an extra retry. A participant who cannot continue can be marked as forfeiting the stage; the administrator can reverse the forfeit while the stage is open. Previously entered results are preserved for possible reactivation.

## 3. Watch the standings

Each station ranks active players by their best attempt. The shared points schedule converts each game ranking into points for the combined leaderboard. Standings update as attempts arrive or are changed and are clearly marked preliminary while results are pending. Forfeited players appear below active players, and their saved results are excluded from the active rankings.

## 4. Finish the initial stage and advance

The stage cannot close until every participant has a result for each required attempt at both stations or a recorded stage-wide forfeit. Once complete, the organizer closes the stage. The next stage's participant count determines the number of advancement places; withdrawn and forfeited participants are not eligible. Qualifiers are placed in the next stage automatically once advancement is resolved, including any required tie-breaker. If too few eligible players remain, the organizer is warned and can adjust the structure.

If a combined tie crosses the advancement cutoff, the configured tie-breaker becomes visible and is played. The organizer records its winner for a two-player duel, or the order for a multiplayer game with a clear ranking. Its outcome resolves the contested places.

## 5. Play the remaining stages

In the multiplayer elimination game, the elimination order is recorded as players go out; the final survivor is not entered as eliminated. For the first event's fighting final, round wins are entered and counted as the duel progresses. Whoever holds the tablet or notebook can enter eliminations, tie-breaker outcomes, and fighting-round wins without an administrator PIN; editing already entered results remains protected. The concluding stage determines the tournament winner.

## Corrections and recovery

Administrators can edit results in open stages. To correct a closed stage, it must first be reopened; that is allowed only when no results exist in the subsequent stage. Entered results in that subsequent stage must first be deleted. Setup can be saved and resumed after a crash. If a station loses its connection during result entry, keep the entered value visible and ask the player to submit once reconnected. A short interruption does not immediately release the station lock. An administrator can release it with the PIN if the device crashes or disappears, allowing another device to take over; the old lock cannot be used if the original device returns. Broader recovery and conflicting-entry behavior still need specification.

## Open questions for review


The interface layout and exact wording are not fixed by this draft.
