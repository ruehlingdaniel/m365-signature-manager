import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { runMigrations } from './lib/db.js';
import { seedInitialAdmin } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { templateRoutes } from './routes/templates.js';
import { footerRoutes } from './routes/footer.js';
import { userRoutes } from './routes/users.js';
import { serverRoutes } from './routes/servers.js';
import { deployRoutes } from './routes/deploy.js';
import { auditRoutes } from './routes/audit.js';
import { assetRoutes } from './routes/assets.js';
import { settingsRoutes } from './routes/settings.js';
import { startScheduler } from './lib/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  console.error('ENCRYPTION_KEY env var muss gesetzt sein (32 bytes hex). Generieren: openssl rand -hex 32');
  process.exit(1);
}

runMigrations();
await seedInitialAdmin();

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  // HSTS aus, da App in der Regel intern via HTTP laeuft
  hsts: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.jsdelivr.net'],
      'script-src': ["'self'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', "'unsafe-inline'", "'unsafe-eval'"],
      'style-src': ["'self'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
      'font-src': ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/footer', footerRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/settings', settingsRoutes);

// Frontend (vanilla single-page) liegt unter ../frontend/public
const FRONTEND_DIR = join(__dirname, '..', 'frontend', 'public');
if (existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(FRONTEND_DIR, 'index.html')));
}

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
  console.log(`[server] M365 Signature Manager listening on :${PORT}`);
  startScheduler();
});
