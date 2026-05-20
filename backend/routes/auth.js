import { Router } from 'express';
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
