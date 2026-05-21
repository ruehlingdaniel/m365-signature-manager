import { Router } from 'express';
import { db, getSetting, setSetting } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { runLogCleanup } from '../lib/log-cleanup.js';

export const settingsRoutes = Router();

// Whitelist der per API setzbaren Keys (gegen Missbrauch).
const ALLOWED_KEYS = new Set([
  'company_logo_asset_id',
  'company_logo_width',
  'company_logo_alt',
  'default_signature_name',
  'disable_roaming_signatures',
  'auto_deploy_enabled',
  'auto_deploy_time',  // "HH:MM"
  'log_retention_days',
  'roaming_banner_dismissed', // UI: banner ausgeblendet
]);

settingsRoutes.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

settingsRoutes.put('/', requireAuth, (req, res) => {
  const updates = req.body || {};
  const applied = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    setSetting(key, value == null ? null : String(value));
    applied[key] = value;
  }
  if (Object.keys(applied).length === 0) {
    return res.status(400).json({ error: 'Keine erlaubten Keys uebergeben' });
  }
  logAudit(req, 'settings.update', { details: applied });
  res.json({ ok: true, applied });
});

// Loescht audit_log + deploy_log Eintraege aelter als log_retention_days. Manuelles Trigger.
settingsRoutes.post('/log-cleanup', requireAuth, (req, res) => {
  const result = runLogCleanup();
  logAudit(req, 'settings.log_cleanup', { details: result });
  res.json(result);
});

// Convenience: Logo direkt setzen/leeren
settingsRoutes.put('/logo', requireAuth, (req, res) => {
  const { asset_id, width, alt } = req.body || {};
  setSetting('company_logo_asset_id', asset_id == null || asset_id === '' ? null : String(asset_id));
  if (width !== undefined) setSetting('company_logo_width', String(width));
  if (alt !== undefined) setSetting('company_logo_alt', String(alt));
  logAudit(req, 'settings.logo_set', { details: { asset_id, width } });
  res.json({ ok: true });
});
