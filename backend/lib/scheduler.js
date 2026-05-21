// Minute-Ticker. Prueft Settings, fuehrt taegliches Deploy-All aus wenn passend.

import { getSetting } from './db.js';
import { logAudit } from './audit.js';
import { runDeployAll } from '../routes/deploy.js';
import { runLogCleanup, shouldRunCleanup } from './log-cleanup.js';

let timer = null;
let lastFiredKey = ''; // YYYY-MM-DD_HH:MM — verhindert mehrfache Triggers innerhalb derselben Minute

function fmt(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function tick() {
  try {
    // Log-Retention: einmal pro Tag (24h Cooldown ueber log_cleanup_last_run Setting).
    if (shouldRunCleanup()) {
      try { runLogCleanup(); }
      catch (err) { console.warn('[scheduler] log-cleanup failed:', err.message); }
    }

    const enabled = getSetting('auto_deploy_enabled');
    if (enabled !== '1' && enabled !== 'true') return;
    const time = getSetting('auto_deploy_time') || '03:00';
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!m) return;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const now = new Date();
    if (now.getHours() !== hh || now.getMinutes() !== mm) return;
    const key = fmt(now);
    if (lastFiredKey === key) return; // schon gefeuert
    lastFiredKey = key;

    console.log(`[scheduler] Triggering auto-deploy at ${key}`);
    const result = await runDeployAll({});
    if (result.error) {
      console.warn('[scheduler] auto-deploy failed:', result.error);
      logAudit({}, 'scheduler.deploy_failed', { details: { error: result.error } });
    } else {
      console.log('[scheduler] auto-deploy done:', JSON.stringify(result));
      logAudit({}, 'scheduler.deploy_done', { details: result });
    }
  } catch (err) {
    console.error('[scheduler] tick error:', err.message);
  }
}

export function startScheduler() {
  if (timer) return;
  // Alle 60 Sekunden tick. Erster tick gleich.
  timer = setInterval(tick, 60 * 1000);
  console.log('[scheduler] gestartet (Minuten-Ticker fuer Auto-Deploy)');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
