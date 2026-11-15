import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/src/app';

describe('tournament setup', () => {
  it('persists participants, protects edits, and keeps real names private', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-test-')); const path = join(dir, 'test.sqlite');
    let app = await createApp(path);
    try {
      const created = await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Birthday', pin: '1234' } });
      expect(created.statusCode).toBe(201);
      const { id, token } = created.json(); const url = `/api/tournaments/${id}/participants`;
      expect((await app.inject({ method: 'POST', url, payload: { displayName: 'Ace' } })).statusCode).toBe(401);
      const added = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: { displayName: 'Ace', realName: 'Alex' } });
      expect(added.statusCode).toBe(201);
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${id}` })).json().participants).toEqual([{ id: added.json().id, displayName: 'Ace' }]);
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${id}`, headers: { authorization: `Bearer ${token}` } })).json().participants[0].realName).toBe('Alex');
      await app.close(); app = await createApp(path);
      expect((await app.inject({ method: 'POST', url: `/api/tournaments/${id}/login`, payload: { pin: '0000' } })).statusCode).toBe(401);
      const login = await app.inject({ method: 'POST', url: `/api/tournaments/${id}/login`, payload: { pin: '1234' } });
      expect(login.statusCode).toBe(200);
      const auth = { authorization: `Bearer ${login.json().token}` };
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${id}`, headers: auth })).json().participants[0].displayName).toBe('Ace');
      expect((await app.inject({ method: 'PUT', url: `${url}/${added.json().id}`, headers: auth, payload: { displayName: 'Champion' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `${url}/${added.json().id}`, headers: auth })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${id}` })).json().participants).toEqual([]);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
