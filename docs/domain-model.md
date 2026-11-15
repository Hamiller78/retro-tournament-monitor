# Tournament domain model — first draft

This is a conceptual model for review, not a database schema or implementation plan. [Tournament domain decisions](tournament-domain.md) remain the record of agreed behavior. Names and relationships here are proposals unless identified there as decisions.

## Main concepts

| Concept | Meaning and relationships |
| --- | --- |
| Tournament | An event with participants and an ordered structure of stages. Its organizer can prepare and adjust that structure. |
| Participant | One person in a tournament, identified by a display name and optionally a real name. A no-show can be removed before play; removal after play starts treats the participant as forfeited throughout the tournament while preserving results and excluding them from advancement. |
| Stage | A configured part of a tournament, with a kind, participant count, participants, results, and open or closed state. Its outcome determines advancement to the following stage or, for the final, the tournament winner. A conditional tie-breaker is shown and played only when needed. |
| Stage participation | A person's involvement and status in a particular stage, including a stage-wide forfeit. This is distinct from the person and from withdrawal from the tournament. Exact status terminology remains open. |
| Game selection | A game chosen for a stage or station. Initial-round stations select from separately configured pools using wheels and confirmation by anyone at the screen; later games are chosen directly for the described event. There is no reusable game library requirement. |
| Attempt and result | A result records what happened in an attempt or match. The initial round has a configured number of attempts per player and station, with score or time values and a best-attempt rule. Other stages record elimination order, match outcomes, or tie-breaker order as appropriate. |
| Ranking and advancement | Rankings are calculated from relevant results and stage rules. Eligible players advance into the configured places of the next stage. A vacancy is an empty position, not a participant. |

## Stage kinds

- **Two-station ranking:** Each participant is expected to play both separately selected games. Each game ranks players by their best attempt, with higher or lower values winning as configured. A shared points schedule converts each ranking to points for the combined leaderboard. Equal results share points for their rank and subsequent ranks are skipped. Positions beyond the schedule receive zero. Preliminary standings change as results arrive.
- **Multiplayer elimination:** One game, no multiple attempts. The elimination sequence determines the ranking; the final survivor need not be entered as eliminated.
- **Fighting duel:** For the first tournament, the final is a duel with round wins recorded and counted as they happen. It supports a single match or a best-of series, including best of three and best of five.
- **Tie-breaker:** A conditional single game and match for players tied across an advancement cutoff. A two-player duel can record its winner; a game for more players produces an order. It may be configured in advance and hidden until needed.

A **final** is the role of the concluding stage, not a separate fixed format. It can use any suitable stage format that determines a clear winner, such as direct-duel survival or highest score. Which additional formats are included beyond those described here remains to be specified.

## State and changes

- Players can submit initial-round attempts without administrator login. A shared administrator PIN protects setup and editing or deleting entered results. An administrator can edit results in an open stage.
- Missing attempts remain pending; the initial stage cannot close until every required attempt is recorded or the participant has a stage-wide forfeit. A dummy value may be entered for an unused attempt.
- A stage forfeit makes a participant ineligible to advance and places them below active players on the combined leaderboard. Their saved results are retained but excluded from game rankings and points while the forfeit is active. Withdrawal applies a stage-wide forfeit to resolve remaining station games. A forfeit can be reversed while the stage is open.
- Entering, changing, or deleting results, or reversing a forfeit, updates the relevant rankings and leaderboard. An administrator can delete a result to permit an extra attempt.
- A closed stage must be reopened before editing its results. Reopening is allowed only when the subsequent stage has no entered results; those results must first be deleted if present.
- The next stage's configured participant count sets the number of advancement places. If too few eligible participants remain, warn the organizer and allow adjustments; stage settings, including participant counts, can be changed during the tournament only while that stage has no results.

## Open design questions

- How does a tie-breaker attach to a stage and supply its ordered outcome when several advancement places are contested?
- What are the precise relationships between tournament withdrawal, stage forfeiture, reactivation, and reopening? In particular, how does reactivation interact with an automatically applied forfeit?
- How are forfeited participants ordered among themselves, and where is the optional real name visible?
- When an active scoring stage can accept a replacement, what are the exact eligibility and shortfall rules? Already active simultaneous semifinals and finals cannot add replacements. Detailed vacancy and bye behavior is also open.
- Racing times are entered and displayed as minutes and seconds (mm:ss), with optional fractional seconds; existing numeric values remain stored in seconds. What should happen when a wheel pool has no eligible different game remains open.
- How should the app behave through disconnection, reconnection, conflicting entries, and recovery? See [architecture](architecture.md).

These questions do not require building the application now. No storage layout, API, or screen design is prescribed by this draft.
