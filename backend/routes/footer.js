import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { sanitize } from '../lib/renderer.js';

export const footerRoutes = Router();

footerRoutes.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM mandatory_footer WHERE id = 1').get();
  res.json(row);
});

footerRoutes.put('/', requireAuth, (req, res) => {
  const f = req.body || {};
  const html = sanitize(f.html_body || '');
  db.prepare(`
    UPDATE mandatory_footer SET enabled = ?, html_body = ?,
      apply_to_new = ?, apply_to_reply = ?, apply_to_forward = ?, external_only = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    f.enabled ? 1 : 0, html,
    f.apply_to_new !== false ? 1 : 0,
    f.apply_to_reply !== false ? 1 : 0,
    f.apply_to_forward !== false ? 1 : 0,
    f.external_only !== false ? 1 : 0,
  );
  res.json({ ok: true });
});
