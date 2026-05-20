import { db } from './db.js';

export function logAudit(req, action, { target = null, details = null } = {}) {
  try {
    const adminUserId = req?.adminUserId || null;
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    db.prepare(`
      INSERT INTO audit_log (admin_user_id, action, target, details, ip)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      adminUserId,
      action,
      target,
      details ? JSON.stringify(details) : null,
      ip ? String(ip).slice(0, 64) : null,
    );
  } catch (err) {
    console.warn('[audit] failed to log:', err.message);
  }
}
