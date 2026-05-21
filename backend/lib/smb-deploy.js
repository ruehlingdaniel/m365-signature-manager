// SMB-Deployment auf Windows-Terminalserver via smbclient (Samba).
// Schreibt Outlook-Signaturen nach \\<host>\C$\Users\<user>\AppData\Roaming\Microsoft\Signatures\

import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SMB_BIN = process.env.SMBCLIENT_BIN || 'smbclient';
const PROTOCOL_OPTS = ['--option=client min protocol=SMB2'];

class SmbError extends Error {
  constructor(message, { stdout, stderr, code } = {}) {
    super(message);
    this.name = 'SmbError';
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

function writeAuthFile(server) {
  const dir = mkdtempSync(join(tmpdir(), 'sigmgr-'));
  const file = join(dir, 'auth');
  const lines = [
    `username = ${server.username}`,
    `password = ${server.password}`,
  ];
  if (server.domain) lines.push(`domain = ${server.domain}`);
  writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return { dir, file };
}

function runSmbclient(server, smbCommands, extraArgs = []) {
  const { dir, file } = writeAuthFile(server);
  const target = `//${server.hostname}/${server.share || 'C$'}`;
  const args = [target, '-A', file, ...PROTOCOL_OPTS, ...extraArgs];
  if (smbCommands) args.push('-c', smbCommands);

  return new Promise((resolve, reject) => {
    const child = spawn(SMB_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      rmSync(dir, { recursive: true, force: true });
      reject(new SmbError(`smbclient spawn failed: ${err.message}`, { stdout, stderr }));
    });
    child.on('close', code => {
      rmSync(dir, { recursive: true, force: true });
      if (code !== 0) {
        return reject(new SmbError(`smbclient exited with code ${code}`, { stdout, stderr, code }));
      }
      // smbclient returns 0 even on some logical failures — check stderr for NT_STATUS_*
      const ntError = (stdout + stderr).match(/NT_STATUS_[A-Z_]+/);
      if (ntError && !/NT_STATUS_OBJECT_NAME_NOT_FOUND/.test(ntError[0])) {
        // OBJECT_NAME_NOT_FOUND we handle via mkdir-on-demand; everything else is fatal
        return reject(new SmbError(`SMB error: ${ntError[0]}`, { stdout, stderr, code }));
      }
      resolve({ stdout, stderr });
    });
  });
}

// Testet die Verbindung — listet den Share-Root.
export async function testConnection(server) {
  try {
    const { stdout } = await runSmbclient(server, 'ls');
    return { ok: true, message: stdout.split('\n').slice(0, 2).join(' ').trim() || 'OK' };
  } catch (err) {
    return { ok: false, message: err.message + (err.stderr ? ` — ${err.stderr.split('\n')[0]}` : '') };
  }
}

// Prueft ob ein User-Profil-Ordner existiert.
export async function profileExists(server, windowsUsername, profilePath = 'Users') {
  const cmd = `cd "${profilePath}\\${windowsUsername}"; pwd`;
  try {
    await runSmbclient(server, cmd);
    return true;
  } catch (err) {
    if (/NT_STATUS_OBJECT_(NAME|PATH)_NOT_FOUND|NT_STATUS_NO_SUCH_FILE/.test(err.message + (err.stderr || ''))) {
      return false;
    }
    throw err;
  }
}

// Leert den gesamten Outlook-Signatures-Ordner eines Users (rekursiv).
// Wird vor dem Deploy aufgerufen, wenn der User das Flag replace_existing_signatures = 1 hat.
// Idempotent: existiert der Ordner nicht, ist das kein Fehler.
export async function wipeSignatureFolder(server, windowsUsername) {
  const profilePath = server.profile_path || 'Users';
  const userBase = `${profilePath}\\${windowsUsername}`;
  const sigDir = `${userBase}\\AppData\\Roaming\\Microsoft\\Signatures`;

  // User-Profil pruefen — wenn nicht vorhanden, gibt es auch keinen Signatures-Ordner.
  const hasProfile = await profileExists(server, windowsUsername, profilePath);
  if (!hasProfile) {
    return { wiped: false, message: `User-Profil "${windowsUsername}" existiert nicht — nichts zu loeschen` };
  }

  // smbclient deltree loescht rekursiv. Existiert der Ordner nicht, ist das ok.
  try {
    await runSmbclient(server, `deltree "${sigDir}"`);
    return { wiped: true, message: `Signatures-Ordner geleert: ${sigDir}` };
  } catch (err) {
    const combined = err.message + (err.stderr || '') + (err.stdout || '');
    if (/NT_STATUS_OBJECT_(NAME|PATH)_NOT_FOUND|NT_STATUS_NO_SUCH_FILE/.test(combined)) {
      return { wiped: false, message: 'Signatures-Ordner existierte nicht' };
    }
    throw err;
  }
}

// Deployt eine Signatur-Bundle (mehrere Dateien + ggf. _files/-Ordner) in ein User-Profil.
// files = [{ remoteName: 'Firma_Standard.htm', localPath: '/tmp/x.htm' }, ...]
// imageFiles = [{ remoteName: 'image001.png', localPath: '/tmp/logo.png' }] -> landen in <name>_files\
export async function deploySignature(server, windowsUsername, signatureName, files, imageFiles = []) {
  const start = Date.now();
  const profilePath = server.profile_path || 'Users';
  const userBase = `${profilePath}\\${windowsUsername}`;
  const sigDir = `${userBase}\\AppData\\Roaming\\Microsoft\\Signatures`;
  const imgDir = `${sigDir}\\${signatureName}_files`;

  // Pre-Check: Existiert das User-Profil?
  const hasProfile = await profileExists(server, windowsUsername, profilePath);
  if (!hasProfile) {
    return {
      status: 'skipped',
      message: `User-Profil "${windowsUsername}" existiert nicht auf ${server.name} (User noch nie eingeloggt?)`,
      files_written: 0,
      bytes_written: 0,
      duration_ms: Date.now() - start,
    };
  }

  // Schritt 1: Verzeichnisstruktur sicherstellen.
  const mkdirCmds = [
    `mkdir "${userBase}\\AppData"`,
    `mkdir "${userBase}\\AppData\\Roaming"`,
    `mkdir "${userBase}\\AppData\\Roaming\\Microsoft"`,
    `mkdir "${sigDir}"`,
  ];
  if (imageFiles.length) mkdirCmds.push(`mkdir "${imgDir}"`);
  // smbclient: mkdir auf existierendes Verzeichnis loggt nur eine Warnung; -c fuehrt alle Cmds aus
  try {
    await runSmbclient(server, mkdirCmds.join('; '));
  } catch (err) {
    // mkdir-Failures auf existierende Dirs schlucken — nur fatal wenn _alle_ scheitern
    if (!/NT_STATUS_OBJECT_NAME_COLLISION/.test(err.message + (err.stderr || ''))) {
      // anderer Fehler — durchreichen
      throw err;
    }
  }

  // Schritt 2: Dateien hochladen.
  let bytesWritten = 0;
  let filesWritten = 0;
  const putCmds = [];
  for (const f of files) {
    putCmds.push(`put "${f.localPath}" "${sigDir}\\${f.remoteName}"`);
    bytesWritten += statSync(f.localPath).size;
  }
  for (const img of imageFiles) {
    putCmds.push(`put "${img.localPath}" "${imgDir}\\${img.remoteName}"`);
    bytesWritten += statSync(img.localPath).size;
  }
  if (putCmds.length === 0) {
    return { status: 'skipped', message: 'Keine Dateien zu deployen', files_written: 0, bytes_written: 0, duration_ms: Date.now() - start };
  }
  await runSmbclient(server, putCmds.join('; '));
  filesWritten = files.length + imageFiles.length;

  return {
    status: 'ok',
    message: `${filesWritten} Datei(en), ${bytesWritten} Bytes -> ${server.name}\\${userBase}`,
    files_written: filesWritten,
    bytes_written: bytesWritten,
    duration_ms: Date.now() - start,
  };
}

export { SmbError };
