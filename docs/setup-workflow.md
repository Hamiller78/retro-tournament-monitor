# Tournament setup workflow — draft

This is a proposed sequence for review, not a final screen design. It uses the [agreed tournament decisions](tournament-domain.md) and [domain model draft](domain-model.md).

## 1. Create the tournament

The organizer creates a tournament, gives it a name, and sets a shared administrator PIN. They can enter the PIN on whichever device they use for administration. The tournament can be prepared ahead of the event; incomplete setup can be saved and its sections revisited in any order, including after a crash.

## 2. Arrange the stages

The organizer adds and orders stages, chooses a format for each, and configures participant counts. For the first event, this includes the two-station ranking stage, multiplayer elimination, and a fighting-duel final. A conditional tie-breaker can be configured in advance and kept hidden until needed. The next stage's participant count determines the available advancement places.

## 3. Configure the games and scoring

For the initial stage, the organizer chooses a separate game pool for each station. For each game, they configure the result format (score or time), whether higher or lower is better, and the number of normal attempts. These settings are independent for each station, including if a game appears in both pools. The two stations share a configurable points schedule. Later-stage games are selected directly in advance for this event; the fighting final is configured for a single match or a best-of series.

## 4. Add participants

The organizer enters each person's display name and, optionally, real name. The list remains quick to change for late arrivals, withdrawals, and no-shows. A display name alone is sufficient.

## 5. Review before play

A proposed setup overview shows the stage order, participant counts, station pools, game rules, points schedule, and participant list. It should make missing or incompatible settings easy to spot and return to. Missing essential settings block the start; potential issues such as too few participants produce a warning so the organizer can act. The exact checks remain to be specified.

The wheels are spun during the event. Anyone can confirm each selection; an administrator can edit the pools until their game is fixed. If the second wheel selects the same game as the first, it can be spun again.

## Still to specify

Define the essential setup checks and warnings. The labels and number of screens are deliberately not fixed here. A later workflow will cover play, advancement, presentation, and corrections.
