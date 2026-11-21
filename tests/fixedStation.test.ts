import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

it.each(['single', 'batch'])('uses a fixed station game without confirmation and records a %s result', async method => {
  const app = await createApp(':memory:');
  try {
    const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Fixed', pin: '1234' } })).json();
    const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
    const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Round', kind: 'two-station', participantCount: 2 } })).json().id;
    const base = `${root}/stages/${stage}`, station = `${base}/stations/0`, game = { name: 'Pong', resultKind: 'score', higherIsBetter: true, attempts: 1 };
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { stations: [{ mode: 'fixed', games: [game] }], points: [1] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${station}/spin` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: root })).json().gameSelectionStarted).toBe(false);
    expect((await app.inject({ method: 'GET', url: station })).json().game.name).toBe('Pong');
    const oldBackup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
    oldBackup.draws = [];
    const restoredOld = (await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup: oldBackup, pin: '1234' } })).json();
    const restoredDetails = (await app.inject({ method: 'GET', url: `/api/tournaments/${restoredOld.id}` })).json();
    expect((await app.inject({ method: 'GET', url: `/api/tournaments/${restoredOld.id}/stages/${restoredDetails.stages[0].id}/stations/0` })).json().game.name).toBe('Pong');
    expect(restoredDetails.gameSelectionStarted).toBe(false);
    const edited = { ...game, name: 'Galaga' };
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { stations: [{ mode: 'fixed', games: [edited] }], points: [1] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: station })).json().game.name).toBe('Galaga');
    const player = (await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Alice' } })).json().id;
    const lock = (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token, owner = { 'x-station-token': lock };
    await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: player } });
    const result = method === 'single' ? await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: { participantId: player, value: 10, requestId: randomUUID() } }) : await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: player, value: 10 }] } });
    expect(result.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: root })).json().gameSelectionStarted).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `${station}/attempts/${player}/1`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: root })).json().gameSelectionStarted).toBe(true);
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { stations: [{ mode: 'fixed', games: [edited] }, { mode: 'fixed', games: [edited] }], points: [1] } })).statusCode).toBe(409);
    const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
    expect((await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } })).statusCode).toBe(201);
  } finally { await app.close(); }
});
