import { db } from './db.js';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '12', 10);

export async function seedInitialAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  if (count > 0) return;
  const username = process.env.INITIAL_ADMIN_USER || 'admin';
  const password = process.env.INITIAL_ADMIN_PASSWORD || 'changeme';
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`[auth] Initialer Admin angelegt: ${username}`);
}

export async function verifyLogin(username, password) {
  const row = db.prepare('SELECT id, password_hash FROM admin_users WHERE username = ?').get(username);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  return ok ? row.id : null;
}

export function createSession(adminUserId) {
  const id = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, admin_user_id, expires_at) VALUES (?, ?, ?)').run(id, adminUserId, expires);
  return { id, expires };
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare('SELECT id, admin_user_id, expires_at FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return row;
}

export function destroySession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function requireAuth(req, res, next) {
  const sid = req.cookies?.sid;
  const session = getSession(sid);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.adminUserId = session.admin_user_id;
  next();
}
