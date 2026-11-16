import { describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';

describe('winner image', () => {
  it('requires admin access, backs up and restores the image, and accepts older backups', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Trophy test', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, headers = { authorization: `Bearer ${token}` };
      expect((await app.inject({ method: 'PUT', url: `${root}/trophy`, payload: { image } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PUT', url: `${root}/trophy`, headers, payload: { image: 'data:image/svg+xml;base64,AAAA' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PUT', url: `${root}/trophy`, headers, payload: { image } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: root })).json().hasTrophyImage).toBe(true);
      const served = await app.inject({ method: 'GET', url: `${root}/trophy` });
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.rawPayload.toString('base64')).toBe(image.split(',')[1]);
      const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
      expect(backup.trophyImage).toBe(image);
      const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}/trophy` })).rawPayload.toString('base64')).toBe(image.split(',')[1]);
      delete backup.trophyImage;
      expect((await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } })).statusCode).toBe(201);
      expect((await app.inject({ method: 'DELETE', url: `${root}/trophy`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: root })).json().hasTrophyImage).toBe(false);
    } finally { await app.close(); }
  });
});
