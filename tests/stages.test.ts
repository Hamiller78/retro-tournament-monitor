import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/src/app';

describe('stage setup', () => {
  it('protects, orders, edits, and persists stages while hiding tie-breakers from spectators', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-stages-')); const path = join(dir, 'test.sqlite');
    let app = await createApp(path);
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const base = `/api/tournaments/${id}/stages`, headers = { authorization: `Bearer ${token}` };
      const first = { name: 'Round one', kind: 'two-station', participantCount: null };
      expect((await app.inject({ method: 'POST', url: base, payload: first })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: base, headers, payload: { ...first, participantCount: -1 } })).statusCode).toBe(400);
      const one = (await app.inject({ method: 'POST', url: base, headers, payload: first })).json().id;
      const two = (await app.inject({ method: 'POST', url: base, headers, payload: { name: 'Semi', kind: 'elimination', participantCount: 4 } })).json().id;
      const tie = (await app.inject({ method: 'POST', url: base, headers, payload: { name: 'Tie', kind: 'tie-breaker', participantCount: null } })).json().id;
      expect((await app.inject({ method: 'POST', url: `${base}/${two}/move`, headers, payload: { direction: 'up' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT', url: `${base}/${one}`, headers, payload: { ...first, name: 'Qualifying', participantCount: 13 } })).statusCode).toBe(200);
      const settings = { stations: [{ games: [{ name: 'Pong', resultKind: 'score', higherIsBetter: true, attempts: 2 }] }, { games: [{ name: 'Race', resultKind: 'time', higherIsBetter: false, attempts: 3 }] }], points: [12, 10, 8] };
      expect((await app.inject({ method: 'PUT', url: `${base}/${one}/settings`, payload: settings })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PUT', url: `${base}/${one}/settings`, headers, payload: settings })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT', url: `${base}/${one}/settings`, headers, payload: { ...settings, points: [-2] } })).statusCode).toBe(400);
      const get = () => app.inject({ method: 'GET', url: `/api/tournaments/${id}`, headers });
      expect((await get()).json().stages.map((s: { id: string }) => s.id)).toEqual([two, one, tie]);
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${id}` })).json().stages.map((s: { id: string }) => s.id)).toEqual([two, one]);
      await app.close(); app = await createApp(path);
      const login = (await app.inject({ method: 'POST', url: `/api/tournaments/${id}/login`, payload: { pin: '1234' } })).json();
      const admin = { authorization: `Bearer ${login.token}` };
      const saved = (await app.inject({ method: 'GET', url: `/api/tournaments/${id}`, headers: admin })).json().stages;
      expect(saved.map((s: { name: string }) => s.name)).toEqual(['Semi', 'Qualifying', 'Tie']);
      expect(saved[1].participantCount).toBe(13);
      expect(saved[1].settings).toEqual(settings);
      expect((await app.inject({ method: 'DELETE', url: `${base}/${tie}`, headers: admin })).statusCode).toBe(200);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
