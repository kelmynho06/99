import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'supabase-direct', time: new Date().toISOString() });
  });

  app.get('/api/migration-sql', (_req, res) => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migration_update.sql');
    if (fs.existsSync(sqlPath)) {
      res.type('text/plain').send(fs.readFileSync(sqlPath, 'utf-8'));
    } else {
      res.status(404).send('-- migration_update.sql não encontrado');
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Velo99 Mobilidade server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
