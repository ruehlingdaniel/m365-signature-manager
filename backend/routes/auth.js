import { Router } from 'express';
import bcrypt from 'bcrypt';
import { verifyLogin, createSession, destroySession, requireAuth } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';

export const authRoutes = Router();

authRoutes.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const userId = await verifyLogin(username, password);
  if (!userId) {
    logAudit({ ip: req.ip }, 'auth.login_failed', { target: username });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const { id, expires } = createSession(userId);
  res.cookie('sid', id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    expires: new Date(expires),
  });
  logAudit({ adminUserId: userId, ip: req.ip }, 'auth.login', { target: username });
  res.json({ ok: true });
});

authRoutes.post('/logout', (req, res) => {
  if (req.cookies?.sid) destroySession(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

authRoutes.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username FROM admin_users WHERE id = ?').get(req.adminUserId);
  res.json(user);
});

// Liste aller Admins (fuer Settings-View)
authRoutes.get('/admins', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, username, created_at FROM admin_users ORDER BY username').all();
  res.json(rows);
});

// Neuen Admin anlegen
authRoutes.post('/admins', requireAuth, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username und password erforderlich' });
  if (password.length < 6) return res.status(400).json({ error: 'Passwort min. 6 Zeichen' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hash);
    logAudit(req, 'admin.create', { target: username, details: { id: r.lastInsertRowid } });
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.status(409).json({ error: 'Username existiert bereits' });
    throw err;
  }
});

// Passwort eines Admins aendern (eigenes oder fremdes — wer eingeloggt ist, darf alle aendern)
authRoutes.put('/admins/:id/password', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'Passwort min. 6 Zeichen' });
  const target = db.prepare('SELECT username FROM admin_users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'not found' });
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, id);
  logAudit(req, 'admin.password_changed', { target: target.username });
  res.json({ ok: true });
});

// Username eines Admins aendern
authRoutes.put('/admins/:id/username', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username erforderlich' });
  const target = db.prepare('SELECT username FROM admin_users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'not found' });
  try {
    db.prepare('UPDATE admin_users SET username = ? WHERE id = ?').run(username, id);
    logAudit(req, 'admin.username_changed', { target: username, details: { old: target.username } });
    res.json({ ok: true });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.status(409).json({ error: 'Username existiert bereits' });
    throw err;
  }
});

// Admin loeschen (nicht sich selbst)
authRoutes.delete('/admins/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.adminUserId) return res.status(400).json({ error: 'Eigenen Account kann man nicht loeschen' });
  const count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  if (count <= 1) return res.status(400).json({ error: 'Letzten Admin kann man nicht loeschen' });
  const target = db.prepare('SELECT username FROM admin_users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
  logAudit(req, 'admin.delete', { target: target.username });
  res.json({ ok: true });
});
