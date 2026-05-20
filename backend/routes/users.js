import { Router } from 'express';
import { db, getSetting } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { buildContext, renderTemplate, sanitize } from '../lib/renderer.js';

export const userRoutes = Router();

const USER_FIELDS = [
  'windows_username', 'display_name', 'email', 'job_title', 'department',
  'company', 'office_location', 'phone', 'mobile', 'fax',
  'street', 'city', 'postal_code', 'country', 'website',
  'template_id', 'signature_name', 'enabled',
];

function normalizeUserInput(body) {
  const u = {};
  for (const key of USER_FIELDS) {
    if (key in body) u[key] = body[key];
  }
  if (body.custom_fields !== undefined) {
    u.custom_fields = typeof body.custom_fields === 'string'
      ? body.custom_fields
      : JSON.stringify(body.custom_fields || {});
  }
  if ('enabled' in u) u.enabled = u.enabled ? 1 : 0;
  if (u.template_id === '' || u.template_id === null) u.template_id = null;
  if (!u.signature_name) {
    u.signature_name = getSetting('default_signature_name') || 'Firma_Standard';
  }
  return u;
}

userRoutes.get('/', requireAuth, (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase();
  const rows = db.prepare(`
    SELECT u.id, u.windows_username, u.display_name, u.email, u.job_title, u.department,
           u.enabled, u.template_id, u.signature_name, u.updated_at,
           t.name AS template_name,
           (SELECT MAX(created_at) FROM deploy_log dl WHERE dl.user_id = u.id) AS last_deploy_at,
           (SELECT status FROM deploy_log dl WHERE dl.user_id = u.id ORDER BY dl.created_at DESC LIMIT 1) AS last_deploy_status
    FROM signature_users u
    LEFT JOIN signature_templates t ON t.id = u.template_id
    WHERE (? = '' OR LOWER(u.display_name) LIKE ? OR LOWER(u.windows_username) LIKE ?
           OR LOWER(IFNULL(u.department, '')) LIKE ? OR LOWER(IFNULL(u.email, '')) LIKE ?)
    ORDER BY u.display_name
  `).all(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json(rows);
});

userRoutes.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM signature_users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  let customFields = {};
  try { customFields = JSON.parse(row.custom_fields || '{}'); } catch {}
  res.json({ ...row, custom_fields: customFields });
});

userRoutes.post('/', requireAuth, (req, res) => {
  const u = normalizeUserInput(req.body || {});
  if (!u.windows_username || !u.display_name) {
    return res.status(400).json({ error: 'windows_username and display_name required' });
  }
  const cols = Object.keys(u);
  const placeholders = cols.map(() => '?').join(', ');
  try {
    const result = db.prepare(`
      INSERT INTO signature_users (${cols.join(', ')}) VALUES (${placeholders})
    `).run(...cols.map(c => u[c]));
    logAudit(req, 'user.create', { target: u.windows_username, details: { id: result.lastInsertRowid } });
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.status(409).json({ error: 'windows_username already exists' });
    throw err;
  }
});

userRoutes.put('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT id, windows_username FROM signature_users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const u = normalizeUserInput(req.body || {});
  if (Object.keys(u).length === 0) return res.json({ ok: true });
  const setClause = Object.keys(u).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE signature_users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(u), id);
  logAudit(req, 'user.update', { target: existing.windows_username, details: { fields: Object.keys(u) } });
  res.json({ ok: true });
});

userRoutes.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT windows_username FROM signature_users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM signature_users WHERE id = ?').run(req.params.id);
  logAudit(req, 'user.delete', { target: row.windows_username });
  res.json({ ok: true });
});

userRoutes.post('/bulk-assign', requireAuth, (req, res) => {
  const { user_ids, template_id } = req.body || {};
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids[] required' });
  const stmt = db.prepare('UPDATE signature_users SET template_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const tx = db.transaction(() => {
    for (const id of user_ids) stmt.run(template_id || null, id);
  });
  tx();
  logAudit(req, 'user.bulk_assign', { details: { count: user_ids.length, template_id } });
  res.json({ ok: true, count: user_ids.length });
});

// Live-Preview: rendert die Signatur fuer einen User mit dem aktuell zugewiesenen Template.
userRoutes.get('/:id/preview', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM signature_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const tplId = req.query.template_id || user.template_id;
  const template = tplId
    ? db.prepare('SELECT * FROM signature_templates WHERE id = ?').get(tplId)
    : db.prepare('SELECT * FROM signature_templates WHERE is_default = 1 LIMIT 1').get();
  if (!template) return res.json({ html: '', warning: 'Kein Template zugewiesen' });
  const ctx = buildContext(user);
  const html = sanitize(renderTemplate(template.html_body, ctx));
  res.json({ html, template_id: template.id, template_name: template.name });
});
