import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './server/app.ts';
import { env, validateEnv } from './server/config/env.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  validateEnv(env);
  const app = createApp();

  if (env.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(
      `[FieldShift AI] Server listening on http://0.0.0.0:${env.port} (${env.nodeEnv}) — API mounted at ${env.apiPrefix}`,
    );
  });
}

startServer().catch((err) => {
  console.error('[FieldShift AI] Failed to start server:', err);
  process.exit(1);
});
