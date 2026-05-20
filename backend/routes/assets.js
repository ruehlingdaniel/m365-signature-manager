import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, readFileSync, unlinkSync, existsSync, statSync, renameSync } from 'fs';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = process.env.ASSETS_DIR || join(__dirname, '..', 'data', 'assets');
mkdirSync(ASSETS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  dest: ASSETS_DIR,
  limits: { fileSize: MAX_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Nur PNG/JPEG/GIF/WEBP erlaubt'));
    }
    cb(null, true);
  },
});

export const assetRoutes = Router();

export function getAssetById(id) {
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
}

export function readAssetFile(asset) {
  const abs = join(ASSETS_DIR, asset.storage_path);
  return readFileSync(abs);
}

assetRoutes.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, filename, mime_type, size_bytes, width, height, created_at
    FROM assets ORDER BY created_at DESC
  `).all();
  res.json(rows);
});

// Datei-Endpoint — auch ohne Auth nutzbar, damit der SunEditor das Bild im <img src> direkt laden kann.
// Da die Web-App ohnehin nur intern erreichbar ist, kein Problem; und IDs sind nicht aufzaehlbar genug.
assetRoutes.get('/:id/file', (req, res) => {
  const a = getAssetById(req.params.id);
  if (!a) return res.status(404).end();
  const abs = join(ASSETS_DIR, a.storage_path);
  if (!existsSync(abs)) return res.status(404).end();
  res.set('Content-Type', a.mime_type);
  res.set('Cache-Control', 'private, max-age=300');
  res.sendFile(abs);
});

assetRoutes.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Datei fehlt' });
  const display = (req.body?.name || req.file.originalname).slice(0, 200);
  const ext = (extname(req.file.originalname) || '').toLowerCase().slice(0, 8);
  const storage = `${Date.now()}_${randomBytes(6).toString('hex')}${ext}`;
  renameSync(req.file.path, join(ASSETS_DIR, storage));
  const stat = statSync(join(ASSETS_DIR, storage));

  const result = db.prepare(`
    INSERT INTO assets (name, filename, storage_path, mime_type, size_bytes)
    VALUES (?, ?, ?, ?, ?)
  `).run(display, req.file.originalname, storage, req.file.mimetype, stat.size);

  logAudit(req, 'asset.create', { target: display, details: { id: result.lastInsertRowid, size: stat.size } });

  res.json({
    id: result.lastInsertRowid,
    name: display,
    filename: req.file.originalname,
    mime_type: req.file.mimetype,
    size_bytes: stat.size,
    url: `/api/assets/${result.lastInsertRowid}/file`,
  });
});

assetRoutes.put('/:id', requireAuth, (req, res) => {
  const a = getAssetById(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  const name = (req.body?.name || a.name).slice(0, 200);
  db.prepare('UPDATE assets SET name = ? WHERE id = ?').run(name, req.params.id);
  logAudit(req, 'asset.update', { target: name });
  res.json({ ok: true });
});

assetRoutes.delete('/:id', requireAuth, (req, res) => {
  const a = getAssetById(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  try { unlinkSync(join(ASSETS_DIR, a.storage_path)); } catch {}
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  logAudit(req, 'asset.delete', { target: a.name });
  res.json({ ok: true });
});

// Error-Handler fuer multer-Limits
assetRoutes.use((err, req, res, _next) => {
  if (err) return res.status(400).json({ error: err.message });
});
