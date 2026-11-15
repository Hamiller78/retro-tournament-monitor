import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('tournament backups', () => {
  it('exports protected data and restores a separate complete copy without station locks', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const person = (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName: 'Racer', realName: 'Alex' } })).json().id;
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: null } })).json().id;
      const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
      const settings = { stations: [{ games: [{ name: 'Race', resultKind: 'time', higherIsBetter: false, attempts: 2, developer: 'Arcade Studio', platform: 'Arcade', releaseYear: 1987, description: 'Race to the finish.' }] }, { games: [] }], points: [5, 2] };
      await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: settings });
      const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
      await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
      const lock = (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token;
      const owner = { 'x-station-token': lock };
      await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: person } });
      await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: { participantId: person, value: 83.45, requestId: randomUUID() } });
      await app.inject({ method: 'POST', url: `${base}/forfeits/${person}`, headers: admin });
      expect((await app.inject({ method: 'GET', url: `${root}/backup` })).statusCode).toBe(401);
      const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers: admin })).json();
      expect(JSON.stringify(backup)).not.toContain(lock);
      expect((await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '9999' } })).statusCode).toBe(401);
      const invalid = structuredClone(backup); invalid.attempts[0].participantId = randomUUID();
      expect((await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup: invalid, pin: '1234' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/api/tournaments' })).json()).toHaveLength(1);
      const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201); const copy = restored.json().id; expect(copy).not.toBe(id);
      const login = (await app.inject({ method: 'POST', url: `/api/tournaments/${copy}/login`, payload: { pin: '1234' } })).json();
      const copyDetails = (await app.inject({ method: 'GET', url: `/api/tournaments/${copy}`, headers: { authorization: `Bearer ${login.token}` } })).json();
      expect(copyDetails.name).toBe('Party (restored)'); expect(copyDetails.participants[0].realName).toBe('Alex');
      const copyStage = copyDetails.stages[0].id; expect(copyStage).not.toBe(stage); expect(copyDetails.stages[0].settings).toEqual(settings);
      const state = (await app.inject({ method: 'GET', url: `/api/tournaments/${copy}/stages/${copyStage}/stations/0` })).json();
      expect(state.locked).toBe(false); expect(state.entries[0].value).toBe(83.45); expect(state.ranking[0].forfeited).toBe(true);
      expect((await app.inject({ method: 'GET', url: '/api/tournaments' })).json()).toHaveLength(2);
    } finally { await app.close(); }
  });
});
