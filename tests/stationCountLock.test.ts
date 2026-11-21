import { it, expect } from 'vitest';
import { createApp } from '../server/src/app';

it('permanently locks station counts after confirming the first game and carries the lock through backups', async () => {
  const app = await createApp(':memory:');
  try {
    const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Lock', pin: '1234' } })).json();
    const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
    const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Round', kind: 'two-station', participantCount: 2 } })).json().id;
    const base = `${root}/stages/${stage}`, one = { games: [{ name: 'Game', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, settings = { stations: [one, one], points: [1] };
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: settings })).statusCode).toBe(200);
    const draw = (await app.inject({ method: 'POST', url: `${base}/stations/0/spin` })).json();
    expect((await app.inject({ method: 'POST', url: `${base}/stations/0/confirm`, payload: { drawId: draw.drawId } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${base}/stations/0/unlock`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { ...settings, stations: [one, one, one] } })).statusCode).toBe(409);
    const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
    const restored = (await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } })).json();
    const copy = `/api/tournaments/${restored.id}`, login = (await app.inject({ method: 'POST', url: `${copy}/login`, payload: { pin: '1234' } })).json(), copyHeaders = { authorization: `Bearer ${login.token}` };
    const copyStage = (await app.inject({ method: 'GET', url: copy, headers: copyHeaders })).json().stages[0].id;
    expect((await app.inject({ method: 'PUT', url: `${copy}/stages/${copyStage}/settings`, headers: copyHeaders, payload: { ...settings, stations: [one] } })).statusCode).toBe(409);
  } finally { await app.close(); }
});
