import { Router } from 'express';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { db } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { renderTemplate, buildContext, sanitize } from '../lib/renderer.js';
import { generateSignatureFiles, buildSetDefaultSignatureScript } from '../lib/sig-files.js';
import { deploySignature, wipeSignatureFolder, SmbError } from '../lib/smb-deploy.js';
import { getServerForDeploy, getAllEnabledServers } from './servers.js';
import { getAssetById, readAssetFile } from './assets.js';

export const deployRoutes = Router();

function loadUser(id) {
  return db.prepare('SELECT * FROM signature_users WHERE id = ?').get(id);
}

function loadTemplateForUser(user) {
  if (user.template_id) {
    return db.prepare('SELECT * FROM signature_templates WHERE id = ?').get(user.template_id);
  }
  return db.prepare('SELECT * FROM signature_templates WHERE is_default = 1 LIMIT 1').get();
}

// Ersetzt im HTML alle /api/assets/<id>/file URLs durch data:-URIs,
// damit der Signatur-Bundler die Bilder als <name>_files/imageNNN.<ext> mit deployt.
function inlineAssetUrls(html) {
  return (html || '').replace(/(<img\b[^>]*\bsrc=)(["'])([^"']*\/api\/assets\/(\d+)\/file[^"']*)\2/gi,
    (full, head, q, _url, idStr) => {
      const asset = getAssetById(idStr);
      if (!asset) return full;
      try {
        const buf = readAssetFile(asset);
        const dataUri = `data:${asset.mime_type};base64,${buf.toString('base64')}`;
        return `${head}${q}${dataUri}${q}`;
      } catch {
        return full;
      }
    });
}

function recordDeployResult(userId, serverId, result) {
  db.prepare(`
    INSERT INTO deploy_log (user_id, server_id, status, message, files_written, bytes_written, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, serverId, result.status,
    (result.message || '').slice(0, 1000),
    result.files_written || 0,
    result.bytes_written || 0,
    result.duration_ms || 0,
  );
}

// Erzeugt einmalig pro User die Signatur-Dateien als Tempdir.
// Liefert { dir, files: [...], imageFiles: [...], signatureName, cleanup }
function materializeUserSignature(user) {
  const template = loadTemplateForUser(user);
  if (!template) {
    return { error: 'Kein Template (weder zugewiesen noch Default)' };
  }
  const ctx = buildContext(user);
  const renderedRaw = renderTemplate(template.html_body, ctx);
  const rendered = sanitize(renderedRaw);
  const withInlineAssets = inlineAssetUrls(rendered);
  const signatureName = user.signature_name || 'Firma_Standard';
  const { htm, txt, rtf, images } = generateSignatureFiles(withInlineAssets, signatureName);

  const dir = mkdtempSync(join(tmpdir(), `sigfiles-${user.windows_username}-`));
  const htmPath = join(dir, `${signatureName}.htm`);
  const txtPath = join(dir, `${signatureName}.txt`);
  const rtfPath = join(dir, `${signatureName}.rtf`);
  writeFileSync(htmPath, htm, 'utf8');
  writeFileSync(txtPath, txt, 'utf8');
  writeFileSync(rtfPath, rtf, 'utf8');

  const files = [
    { remoteName: `${signatureName}.htm`, localPath: htmPath },
    { remoteName: `${signatureName}.txt`, localPath: txtPath },
    { remoteName: `${signatureName}.rtf`, localPath: rtfPath },
  ];

  const imageFiles = [];
  for (const img of images) {
    const imgPath = join(dir, img.remoteName);
    writeFileSync(imgPath, img.buffer);
    imageFiles.push({ remoteName: img.remoteName, localPath: imgPath });
  }

  // Startup-Script, das beim naechsten User-Login auf dem TS unsere Signatur als
  // Outlook-Standard setzt und das Cloud-Roaming abschaltet.
  const startupScriptName = 'Set-Outlook-Default-Signature.cmd';
  const startupPath = join(dir, startupScriptName);
  writeFileSync(startupPath, buildSetDefaultSignatureScript(signatureName), { encoding: 'binary' });
  const startupScript = { remoteName: startupScriptName, localPath: startupPath };

  return {
    signatureName,
    files,
    imageFiles,
    startupScript,
    template,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// POST /api/deploy/user/:id   body: { server_ids?: [int] }
// Deployt einen User auf gewaehlte Server (Default: alle aktivierten).
deployRoutes.post('/user/:id', requireAuth, async (req, res) => {
  const user = loadUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (!user.enabled) return res.status(400).json({ error: 'user is disabled' });

  const serverIds = Array.isArray(req.body?.server_ids) && req.body.server_ids.length
    ? req.body.server_ids
    : null;
  const servers = (serverIds ? serverIds.map(getServerForDeploy).filter(Boolean) : getAllEnabledServers());
  if (servers.length === 0) return res.status(400).json({ error: 'keine aktiven Server' });

  const mat = materializeUserSignature(user);
  if (mat.error) return res.status(400).json({ error: mat.error });

  const results = [];
  try {
    await Promise.all(servers.map(async server => {
      let outcome;
      try {
        if (user.replace_existing_signatures) {
          await wipeSignatureFolder(server, user.windows_username);
        }
        outcome = await deploySignature(server, user.windows_username, mat.signatureName, mat.files, mat.imageFiles, mat.startupScript);
        if (user.replace_existing_signatures && outcome.status === 'ok') {
          outcome.message = `[ersetzt] ${outcome.message}`;
        }
      } catch (err) {
        outcome = {
          status: 'error',
          message: err instanceof SmbError ? err.message : `Fehler: ${err.message}`,
          files_written: 0, bytes_written: 0, duration_ms: 0,
        };
      }
      recordDeployResult(user.id, server.id, outcome);
      results.push({ server_id: server.id, server_name: server.name, ...outcome });
    }));
  } finally {
    mat.cleanup();
  }

  logAudit(req, 'deploy.user', {
    target: user.windows_username,
    details: {
      template_id: mat.template.id,
      servers: results.map(r => ({ name: r.server_name, status: r.status })),
    },
  });
  res.json({ user: user.windows_username, results });
});

// Re-usable Deploy-Funktion (z.B. fuer Scheduler). Liefert Summary oder { error }.
export async function runDeployAll({ serverIds } = {}) {
  const servers = Array.isArray(serverIds) && serverIds.length
    ? serverIds.map(getServerForDeploy).filter(Boolean)
    : getAllEnabledServers();
  if (servers.length === 0) return { error: 'keine aktiven Server' };

  const users = db.prepare('SELECT * FROM signature_users WHERE enabled = 1').all();
  if (users.length === 0) return { error: 'keine aktiven User' };

  const summary = { total_users: users.length, total_servers: servers.length, by_status: { ok: 0, skipped: 0, error: 0 } };

  for (const user of users) {
    const mat = materializeUserSignature(user);
    if (mat.error) {
      for (const s of servers) {
        const out = { status: 'error', message: mat.error, files_written: 0, bytes_written: 0, duration_ms: 0 };
        recordDeployResult(user.id, s.id, out);
        summary.by_status.error += 1;
      }
      continue;
    }
    try {
      await Promise.all(servers.map(async server => {
        let outcome;
        try {
          if (user.replace_existing_signatures) {
            await wipeSignatureFolder(server, user.windows_username);
          }
          outcome = await deploySignature(server, user.windows_username, mat.signatureName, mat.files, mat.imageFiles, mat.startupScript);
          if (user.replace_existing_signatures && outcome.status === 'ok') {
            outcome.message = `[ersetzt] ${outcome.message}`;
          }
        } catch (err) {
          outcome = { status: 'error', message: err.message, files_written: 0, bytes_written: 0, duration_ms: 0 };
        }
        recordDeployResult(user.id, server.id, outcome);
        summary.by_status[outcome.status] = (summary.by_status[outcome.status] || 0) + 1;
      }));
    } finally {
      mat.cleanup();
    }
  }
  return summary;
}

// POST /api/deploy/all   body: { server_ids?: [int] }
// Deployt ALLE aktivierten User auf gewaehlte Server.
deployRoutes.post('/all', requireAuth, async (req, res) => {
  const result = await runDeployAll({ serverIds: req.body?.server_ids });
  if (result.error) return res.status(400).json({ error: result.error });
  logAudit(req, 'deploy.all', { details: result });
  res.json(result);
});

