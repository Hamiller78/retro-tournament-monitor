import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/src/app';

describe('station draws', () => {
  it('requires admin, persists confirmation, rejects duplicates and protects fixed pools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-draw-')); const path = join(dir, 'db.sqlite');
    let app = await createApp(path);
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const headers = { authorization: `Bearer ${token}` };
      const base = `/api/tournaments/${id}/stages`;
      const { id: stage } = (await app.inject({ method: 'POST', url: base, headers, payload: { name: 'First', kind: 'two-station', participantCount: null } })).json();
      const settings = { stations: [{ games: [{ name: 'Pong', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Pong', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [3, 2, 1] };
      const invalid = structuredClone(settings);
      Object.assign(invalid.stations[0].games[0], { releaseYear: 1.5 });
      expect((await app.inject({ method: 'PUT', url: `${base}/${stage}/settings`, headers, payload: invalid })).statusCode).toBe(400);
      await app.inject({ method: 'PUT', url: `${base}/${stage}/settings`, headers, payload: settings });
      const first = `${base}/${stage}/stations/0`, second = `${base}/${stage}/stations/1`;
      expect((await app.inject({ method: 'POST', url: `${first}/spin` })).statusCode).toBe(200);
      const spin = (await app.inject({ method: 'POST', url: `${first}/spin`, headers })).json();
      const next = (await app.inject({ method: 'POST', url: `${first}/spin`, headers })).json();
      expect((await app.inject({ method: 'POST', url: `${first}/confirm`, headers, payload: { drawId: spin.drawId } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `${first}/confirm`, payload: { drawId: next.drawId } })).statusCode).toBe(200);
      const secondSpin = (await app.inject({ method: 'POST', url: `${second}/spin`, headers })).json();
      expect((await app.inject({ method: 'POST', url: `${second}/confirm`, headers, payload: { drawId: secondSpin.drawId } })).statusCode).toBe(409);
      const publicStage = (await app.inject({ method: 'GET', url: `/api/tournaments/${id}` })).json().stages[0];
      expect(publicStage.draws).toHaveLength(2); expect(publicStage.draws[0].confirmed).toBe(true); expect(publicStage.draws[1].confirmed).toBe(false);
      const modified = structuredClone(settings); modified.stations[0].games[0].name = 'Other';
      expect((await app.inject({ method: 'PUT', url: `${base}/${stage}/settings`, headers, payload: modified })).statusCode).toBe(409);
      await app.close(); app = await createApp(path);
      const saved = (await app.inject({ method: 'GET', url: `/api/tournaments/${id}` })).json().stages[0];
      expect(saved.draws[0].gameIndex).toBe(0); expect(saved.draws[0].confirmed).toBe(true);
      const login = (await app.inject({ method: 'POST', url: `/api/tournaments/${id}/login`, payload: { pin: '1234' } })).json();
      const auth = { authorization: `Bearer ${login.token}` };
      expect((await app.inject({ method: 'POST', url: `${first}/unlock`, headers: auth })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT', url: `${base}/${stage}/settings`, headers: auth, payload: modified })).statusCode).toBe(200);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
