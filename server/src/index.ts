import { createApp } from './app';

const app = await createApp(process.env.RETROMANIA_DB_PATH);
try {
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
