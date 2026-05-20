# M365 Signature Manager

Zentrale Verwaltung von Outlook-Signaturen für Windows-Terminalserver — ohne Entra/Graph API.
Deployment der Signatur-Dateien direkt per SMB ins User-Profil der RDS.

## Architektur

```
┌──────────────────────────────────┐
│  Web-Interface (Node/Express)    │
│  - User pflegen                  │
│  - Templates editieren           │
│  - Live-Preview                  │
│  - SMB-Push triggern             │
│  + SQLite, Audit-Log             │
└────────────┬─────────────────────┘
             │ SMB (smbclient) als Service-Account
             ▼
   ┌──────────┬──────────┬──────────┬──────────┐
   │   TS01   │   TS02   │   TS03   │   TS04   │
   │ \C$\Users\<user>\AppData\Roaming\Microsoft\Signatures\
   │    <name>.htm / .rtf / .txt + <name>_files\image001...
   └──────────┴──────────┴──────────┴──────────┘
```

## Setup (lokal, Docker)

```bash
# 1. Optional: eigene Werte in .env eintragen (Standard reicht erstmal)
#    INITIAL_ADMIN_PASSWORD setzen!

# 2. Container starten
docker compose up -d --build

# 3. Logs prüfen
docker compose logs -f signature-manager
```

Web-UI: http://localhost:4000

**Initial-Login:** `admin` / `admin` (aus `.env`) — **nach erstem Start ändern.**

## TS-Konfiguration

Damit die Signaturen automatisch im Outlook erscheinen und beim Antworten/Weiterleiten an die richtige Stelle gesetzt werden, muss auf jedem Terminalserver **einmalig** dieser Registry-Block gesetzt sein. Per GPO (Group Policy Preferences → Registry) am cleanesten:

```reg
[HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\Common\MailSettings]
"NewSignature"="Firma_Standard"
"ReplySignature"="Firma_Standard"

[HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\Outlook\Setup]
"DisableRoamingSignaturesTemporaryToggle"=dword:00000001
"DisableRoamingSignatures"=dword:00000001
```

- `NewSignature` / `ReplySignature` → Outlook nutzt diese Signatur automatisch (richtige Position bei Reply/Forward)
- `DisableRoamingSignatures*` → verhindert dass der M365-Cloud-Sync die lokalen Dateien überschreibt

Der Signatur-Name (`Firma_Standard`) muss mit dem Feld `signature_name` des jeweiligen Users im Webinterface übereinstimmen (Default ist `Firma_Standard`).

## Bedienung

1. **Terminalserver eintragen** (Menüpunkt *Terminalserver*) — Hostname, Domain, Admin-User + Passwort. „Test"-Button prüft SMB-Verbindung sofort.
2. **Template anlegen oder Default-Template editieren** (Menüpunkt *Templates*) — HTML mit `{{displayName}}`, `{{phone}}` etc.
3. **Mitarbeiter pflegen** (Menüpunkt *Mitarbeiter*) — alle Daten manuell, kein Entra-Sync.
4. **Deploy** — entweder pro User („Deploy" in der Liste) oder gesamt („Alle deployen" im Dashboard).

## Was passiert beim Deploy

Pro User × Server:
1. Template rendern mit den User-Daten
2. Generieren von `<name>.htm` (HTML), `<name>.txt` (Plain) und `<name>.rtf` (RTF-Wrapper)
3. Inline-Bilder aus `data:`-URIs extrahieren → `<name>_files/imageNNN.png`
4. SMB-Upload nach `\\<TS>\C$\Users\<windows_username>\AppData\Roaming\Microsoft\Signatures\`
5. Status in `deploy_log` schreiben

Wenn das User-Profil auf dem TS noch nicht existiert (User noch nie eingeloggt) → Status `skipped`, kein Fehler.

## Sicherheit

- SMB-Passwörter sind AES-256-GCM verschlüsselt in SQLite gespeichert (`ENCRYPTION_KEY` aus `.env`)
- Web-Login: bcrypt-Hash, Session-Cookie httpOnly+sameSite, Rate-Limit auf Login
- SMB-Auth läuft über tmpfile (Passwort nicht in der Prozessliste)
- Helmet + CSP gesetzt
- Audit-Log für alle CRUD-Operationen + Logins/Deploys

## Verzeichnisstruktur

```
m365-signature-manager/
├── backend/             # Express + SQLite
│   ├── server.js
│   ├── lib/
│   │   ├── smb-deploy.js        # smbclient wrapper
│   │   ├── sig-files.js         # .htm/.rtf/.txt Generator
│   │   ├── renderer.js          # Template Render + Sanitize
│   │   ├── crypto.js            # AES-GCM
│   │   ├── auth.js, db.js, audit.js
│   ├── routes/                  # auth, users, templates, footer, servers, deploy, audit
│   └── migrations/              # SQL-Schema
├── frontend/public/     # Vanilla JS + Tailwind CDN (single-page)
├── data/                # SQLite Volume (vom Container gemountet)
├── Dockerfile
├── docker-compose.yml
└── .env
```

## Was noch fehlt / nice to have

- Logo-Upload als zentral verwaltetes Asset (aktuell: Logo als `data:`-URI direkt im Template-HTML)
- Bulk-Import von Mitarbeitern (CSV)
- Scheduler für tägliches Auto-Deploy
- Server-Deploy-Status pro User (welcher TS hat welchen Stand)
