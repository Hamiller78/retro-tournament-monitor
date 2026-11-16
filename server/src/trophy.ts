import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';

export function validTrophy(value: string): boolean {
  if (value.length > 2_700_000) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2_000_000 || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (match[1] === 'jpeg') return bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function registerTrophyRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/trophy', async (request, reply) => {
    const row = db.prepare('SELECT data FROM trophy_images WHERE tournament_id = ?').get(request.params.id);
    if (!row) return reply.code(404).send({ error: 'No trophy image.' });
    const data = String(row.data), split = data.indexOf(',');
    return reply.header('Cache-Control', 'no-store').type(data.slice(5, data.indexOf(';'))).send(Buffer.from(data.slice(split + 1), 'base64'));
  });
  app.put<{ Params: { id: string }; Body: { image?: unknown } }>('/api/tournaments/:id/trophy', async (request, reply) => {
    const { id } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const image = request.body?.image;
    if (typeof image !== 'string' || !validTrophy(image)) return reply.code(400).send({ error: 'Choose a PNG, JPEG or WebP image up to 2 MB.' });
    db.prepare('INSERT INTO trophy_images (tournament_id, data) VALUES (?, ?) ON CONFLICT(tournament_id) DO UPDATE SET data = excluded.data').run(id, image);
    changed(id); return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/tournaments/:id/trophy', async (request, reply) => {
    const { id } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    db.prepare('DELETE FROM trophy_images WHERE tournament_id = ?').run(id); changed(id); return { ok: true };
  });
}
