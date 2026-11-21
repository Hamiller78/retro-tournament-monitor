import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

it('draws a first-stage elimination game and restores its selection and results', async () => {
  const app = await createApp(':memory:');
  try {
    const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Pool', pin: '1234' } })).json();
    const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
    const alice = (await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Alice' } })).json().id;
    const bob = (await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Bob' } })).json().id;
    const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Final', kind: 'elimination', participantCount: 2 } })).json().id;
    const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { game: '', gameSelection: 'pool', gamePool: ['Pong'] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${base}/outcome`, payload: { participantId: bob, requestId: randomUUID() } })).statusCode).toBe(409);
    const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
    expect((await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${base}/outcome` })).json().game).toBe('Pong');
    expect((await app.inject({ method: 'POST', url: `${base}/outcome`, payload: { participantId: bob, requestId: randomUUID() } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `${root}/winner` })).json().winner.id).toBe(alice);
    expect((await app.inject({ method: 'POST', url: `${station}/unlock`, headers })).statusCode).toBe(409);
    const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
    const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
    expect(restored.statusCode).toBe(201);
    const copy = (await app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}` })).json();
    expect((await app.inject({ method: 'GET', url: `/api/tournaments/${copy.id}/stages/${copy.stages[0].id}/outcome` })).json().game).toBe('Pong');
  } finally { await app.close(); }
});


it('uses a fixed game immediately on a new elimination stage', async () => {
  const app = await createApp(':memory:');
  try {
    const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Fixed stage', pin: '1234' } })).json();
    const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
    const people: string[] = [];
    for (const displayName of ['Alice', 'Bob']) people.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName } })).json().id);
    const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Final', kind: 'elimination', participantCount: 2 } })).json().id;
    const base = `${root}/stages/${stage}`;
    await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { game: 'Pong', gameSelection: 'fixed' } });
    expect((await app.inject({ method: 'GET', url: `${base}/outcome` })).json().game).toBe('Pong');
    expect((await app.inject({ method: 'GET', url: root })).json().gameSelectionStarted).toBe(false);
    expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: { game: 'Galaga', gameSelection: 'fixed' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${base}/outcome` })).json().game).toBe('Galaga');
    expect((await app.inject({ method: 'POST', url: `${base}/outcome`, payload: { participantId: people[1], requestId: randomUUID() } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: root })).json().gameSelectionStarted).toBe(true);
    const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
    expect((await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } })).statusCode).toBe(201);
  } finally { await app.close(); }
});
