import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { logAudit } from '../lib/audit.js';
import { testConnection } from '../lib/smb-deploy.js';

export const serverRoutes = Router();

function rowToPublic(row) {
  if (!row) return row;
  const { password_encrypted, ...rest } = row;
  return { ...rest, has_password: !!password_encrypted };
}

function rowToInternal(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    share: row.share,
    profile_path: row.profile_path,
    domain: row.domain,
    username: row.username,
    password: decrypt(row.password_encrypted),
    enabled: row.enabled,
  };
}

export function getServerForDeploy(id) {
  const row = db.prepare('SELECT * FROM terminal_servers WHERE id = ? AND enabled = 1').get(id);
  return rowToInternal(row);
}

export function getAllEnabledServers() {
  const rows = db.prepare('SELECT * FROM terminal_servers WHERE enabled = 1 ORDER BY name').all();
  return rows.map(rowToInternal);
}

serverRoutes.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, hostname, share, profile_path, domain, username, enabled,
           last_check_at, last_check_ok, last_check_message, created_at, updated_at,
           password_encrypted
    FROM terminal_servers ORDER BY name
  `).all();
  res.json(rows.map(rowToPublic));
});

serverRoutes.post('/', requireAuth, (req, res) => {
  const { name, hostname, share, profile_path, domain, username, password, enabled } = req.body || {};
  if (!name || !hostname || !username || !password) {
    return res.status(400).json({ error: 'name, hostname, username, password erforderlich' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO terminal_servers (name, hostname, share, profile_path, domain, username, password_encrypted, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, hostname,
      share || 'C$',
      profile_path || 'Users',
      domain || null,
      username,
      encrypt(password),
      enabled === false ? 0 : 1,
    );
    logAudit(req, 'server.create', { target: name, details: { hostname } });
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.status(409).json({ error: 'server name already exists' });
    throw err;
  }
});

serverRoutes.put('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT name FROM terminal_servers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { name, hostname, share, profile_path, domain, username, password, enabled } = req.body || {};
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (hostname !== undefined) { updates.push('hostname = ?'); params.push(hostname); }
  if (share !== undefined) { updates.push('share = ?'); params.push(share || 'C$'); }
  if (profile_path !== undefined) { updates.push('profile_path = ?'); params.push(profile_path || 'Users'); }
  if (domain !== undefined) { updates.push('domain = ?'); params.push(domain || null); }
  if (username !== undefined) { updates.push('username = ?'); params.push(username); }
  if (password) { updates.push('password_encrypted = ?'); params.push(encrypt(password)); }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  if (updates.length === 0) return res.json({ ok: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  db.prepare(`UPDATE terminal_servers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit(req, 'server.update', { target: existing.name, details: { fields: updates } });
  res.json({ ok: true });
});

serverRoutes.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT name FROM terminal_servers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM terminal_servers WHERE id = ?').run(req.params.id);
  logAudit(req, 'server.delete', { target: row.name });
  res.json({ ok: true });
});

serverRoutes.post('/:id/test', requireAuth, async (req, res) => {
  const internal = rowToInternal(db.prepare('SELECT * FROM terminal_servers WHERE id = ?').get(req.params.id));
  if (!internal) return res.status(404).json({ error: 'not found' });
  const result = await testConnection(internal);
  db.prepare(`
    UPDATE terminal_servers
    SET last_check_at = CURRENT_TIMESTAMP, last_check_ok = ?, last_check_message = ?
    WHERE id = ?
  `).run(result.ok ? 1 : 0, result.message.slice(0, 500), req.params.id);
  logAudit(req, 'server.test', { target: internal.name, details: { ok: result.ok } });
  res.json(result);
});
