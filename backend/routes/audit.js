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

// GET /api/audit/matrix
// Liefert pro User × Server den letzten Deploy-Status. Liefert auch Header-Listen.
auditRoutes.get('/matrix', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT id, windows_username, display_name, department, enabled
    FROM signature_users
    ORDER BY display_name
  `).all();

  const servers = db.prepare(`
    SELECT id, name, hostname, enabled
    FROM terminal_servers
    ORDER BY name
  `).all();

  // Letzter Deploy pro (user_id, server_id)
  const latest = db.prepare(`
    SELECT d.user_id, d.server_id, d.status, d.message, d.created_at, d.duration_ms
    FROM deploy_log d
    INNER JOIN (
      SELECT user_id, server_id, MAX(id) AS max_id
      FROM deploy_log
      GROUP BY user_id, server_id
    ) m ON m.max_id = d.id
  `).all();

  const matrix = {};
  for (const row of latest) {
    if (!matrix[row.user_id]) matrix[row.user_id] = {};
    matrix[row.user_id][row.server_id] = {
      status: row.status,
      message: row.message,
      created_at: row.created_at,
      duration_ms: row.duration_ms,
    };
  }

  res.json({ users, servers, matrix });
});
