import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { sanitize, AVAILABLE_VARIABLES, renderTemplate, buildContext } from '../lib/renderer.js';

export const templateRoutes = Router();

templateRoutes.get('/variables', requireAuth, (req, res) => {
  res.json(AVAILABLE_VARIABLES);
});

templateRoutes.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, description, is_default, apply_to_new, apply_to_reply, apply_to_forward,
           internal_only, created_at, updated_at
    FROM signature_templates ORDER BY is_default DESC, name
  `).all();
  res.json(rows);
});

templateRoutes.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM signature_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

templateRoutes.post('/', requireAuth, (req, res) => {
  const t = req.body || {};
  if (!t.name) return res.status(400).json({ error: 'name required' });
  const html = sanitize(t.html_body || '');
  const result = db.prepare(`
    INSERT INTO signature_templates (name, description, html_body, is_default,
      apply_to_new, apply_to_reply, apply_to_forward, internal_only)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.name, t.description || '', html,
    t.is_default ? 1 : 0,
    t.apply_to_new !== false ? 1 : 0,
    t.apply_to_reply !== false ? 1 : 0,
    t.apply_to_forward !== false ? 1 : 0,
    t.internal_only ? 1 : 0,
  );
  if (t.is_default) {
    db.prepare('UPDATE signature_templates SET is_default = 0 WHERE id != ?').run(result.lastInsertRowid);
  }
  res.json({ id: result.lastInsertRowid });
});

templateRoutes.put('/:id', requireAuth, (req, res) => {
  const t = req.body || {};
  const id = parseInt(req.params.id, 10);
  const html = sanitize(t.html_body || '');
  db.prepare(`
    UPDATE signature_templates SET name = ?, description = ?, html_body = ?,
      is_default = ?, apply_to_new = ?, apply_to_reply = ?, apply_to_forward = ?,
      internal_only = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    t.name, t.description || '', html,
    t.is_default ? 1 : 0,
    t.apply_to_new !== false ? 1 : 0,
    t.apply_to_reply !== false ? 1 : 0,
    t.apply_to_forward !== false ? 1 : 0,
    t.internal_only ? 1 : 0,
    id,
  );
  if (t.is_default) {
    db.prepare('UPDATE signature_templates SET is_default = 0 WHERE id != ?').run(id);
  }
  res.json({ ok: true });
});

templateRoutes.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM signature_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Live-Preview mit echten oder Beispiel-User-Daten
templateRoutes.post('/:id/preview', requireAuth, (req, res) => {
  const tpl = db.prepare('SELECT html_body FROM signature_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'not found' });
  const userId = req.body?.user_id;
  let user = userId ? db.prepare('SELECT * FROM signature_users WHERE id = ?').get(userId) : null;
  if (!user) {
    user = {
      windows_username: 'mmuster',
      display_name: 'Max Mustermann',
      job_title: 'Geschaeftsfuehrer', department: 'Vertrieb', company: 'Beispiel GmbH',
      office_location: 'Hauptsitz', email: 'max.mustermann@example.com',
      phone: '+49 6341 1234567', mobile: '+49 170 1234567', fax: '+49 6341 1234568',
      street: 'Musterstrasse 1', city: 'Musterstadt', postal_code: '12345', country: 'DE',
      website: 'https://example.com',
    };
  }
  res.json({ html: renderTemplate(tpl.html_body, buildContext(user)) });
});
