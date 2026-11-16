import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/src/app';

describe('shared TV view', () => {
  it('persists the selected wheel, isolates tournaments, and rejects invalid views', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-tv-')), db = join(dir, 'database.sqlite');
    let app = await createApp(db);
    try {
      const first = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const second = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Other', pin: '1234' } })).json();
      const root = `/api/tournaments/${first.id}`, admin = { authorization: `Bearer ${first.token}` };
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: null } })).json().id;
      const pending = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Later', kind: 'two-station', participantCount: 2 } })).json().id;
      const url = `${root}/display-view`;
      expect((await app.inject({ method: 'PUT', url, payload: { mode: 'wheel', stageId: pending, station: 0 } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'PUT', url, payload: { mode: 'wheel', stageId: stage, station: 2 } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PUT', url, payload: { mode: 'wheel', stageId: stage, station: 1 } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: root })).json().displayWheel).toEqual({ stageId: stage, station: 1 });
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${second.id}` })).json().displayWheel).toBeNull();
      await app.close(); app = await createApp(db);
      expect((await app.inject({ method: 'GET', url: root })).json().displayWheel).toEqual({ stageId: stage, station: 1 });
      expect((await app.inject({ method: 'PUT', url, payload: { mode: 'ranking' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: root })).json().displayWheel).toBeNull();
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
