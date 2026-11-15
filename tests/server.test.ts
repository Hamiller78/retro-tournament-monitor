import { describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app';

describe('server foundation', () => {
  it('reports status and closes cleanly', async () => {
    const app = await createApp(':memory:');
    try {
      const response = await app.inject({ method: 'GET', url: '/api/status' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally { await app.close(); }
  });
});
