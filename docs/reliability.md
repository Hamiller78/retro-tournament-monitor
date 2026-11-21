# Reliability and recovery

## Agreed behavior

- Submitted results are saved on the server immediately. Confirmed results must be restored after a server restart.
- If a station loses its connection while a result is being entered, keep the unsubmitted value visible and let the user submit it after reconnection.
- If the server goes down, clients show that they are disconnected and resume after the server restarts. Full offline operation is not a first-version promise.
- The administrator can download a complete tournament backup, including configuration, participants, games, and results, for restoration on another computer. Restoring creates a separate tournament copy rather than overwriting an existing tournament. Manual downloads are available at convenient points. The server also creates a local tournament backup each time a stage closes, as an additional recovery point. A local backup is on the host machine, so a downloaded copy elsewhere protects against losing that machine. If the backup fails, warn the organizer but still close the stage. The manual backup and separate-copy restore are implemented; the backup uses the tournament PIN to authorize restoration and does not carry over device locks. Automatic stage-close backups are saved beside the database under the backups directory; if a backup fails, closure still succeeds and the administrator is warned. Retention remains to be specified.
- An administrator can delete a tournament after an in-page confirmation. This removes its data from the app; previously downloaded backups and automatic backup files remain available. Other connected devices are notified.
- Station locks survive brief interruptions. An administrator can release a lost device's lock with the PIN; the old session cannot submit after release. See [station view](station-view.md).

## Possible later improvement

Buffering submitted results during an outage would be useful, but synchronization across rooms and the interaction with station locks require more design. It is not yet an agreed first-version feature.
