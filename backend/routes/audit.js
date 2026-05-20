import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

export const auditRoutes = Router();

auditRoutes.get('/', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const offset = parseInt(req.query.offset || '0', 10);
  const action = req.query.action ? `%${req.query.action}%` : null;
  const where = action ? 'WHERE a.action LIKE ?' : '';
  const params = action ? [action, limit, offset] : [limit, offset];
  const rows = db.prepare(`
    SELECT a.id, a.action, a.target, a.details, a.ip, a.created_at, u.username AS admin
    FROM audit_log a
    LEFT JOIN admin_users u ON u.id = a.admin_user_id
    ${where}
    ORDER BY a.id DESC
    LIMIT ? OFFSET ?
  `).all(...params);
  res.json(rows.map(r => ({ ...r, details: r.details ? safeJsonParse(r.details) : null })));
});

auditRoutes.get('/deploys', requireAuth, (req, res) => {
  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  const serverId = req.query.server_id ? parseInt(req.query.server_id, 10) : null;
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const conds = [];
  const params = [];
  if (userId) { conds.push('d.user_id = ?'); params.push(userId); }
  if (serverId) { conds.push('d.server_id = ?'); params.push(serverId); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  const rows = db.prepare(`
    SELECT d.id, d.status, d.message, d.files_written, d.bytes_written, d.duration_ms, d.created_at,
           u.windows_username, u.display_name,
           s.name AS server_name, s.hostname
    FROM deploy_log d
    LEFT JOIN signature_users u ON u.id = d.user_id
    LEFT JOIN terminal_servers s ON s.id = d.server_id
    ${where}
    ORDER BY d.id DESC
    LIMIT ?
  `).all(...params);
  res.json(rows);
});

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return s; } }
