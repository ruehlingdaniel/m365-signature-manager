// Erzeugt aus einer gerenderten HTML-Signatur die drei Dateien, die Outlook erwartet:
//   <name>.htm  — Haupt-Signatur (HTML-Mails)
//   <name>.txt  — Plain-Text-Variante (TXT-Mails)
//   <name>.rtf  — RTF-Variante (RTF-Mails, selten)
// Plus optional Bilder in <name>_files/.

const HTML_ENTITY_MAP = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&apos;': "'", '&#39;': "'",
};

function decodeEntities(s) {
  return s.replace(/&[a-z]+;|&#\d+;/gi, m => {
    if (HTML_ENTITY_MAP[m]) return HTML_ENTITY_MAP[m];
    const dec = m.match(/^&#(\d+);$/);
    if (dec) return String.fromCharCode(parseInt(dec[1], 10));
    return m;
  });
}

// Plain-Text aus HTML extrahieren.
export function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    // NBSP (U+00A0) -> normales Leerzeichen: in Plain-Text-Formaten (.txt/.rtf) ist die
    // Unterscheidung bedeutungslos. Der SunEditor speichert Mehrfach-Leerzeichen als
    // abwechselnd "nbsp space nbsp space..." — als \u160?-RTF-Escape rendert Word das
    // ungleichmaessig/zu breit. Uniforme Leerzeichen geben konsistente Abstaende.
    .replace(/\u00A0/g, ' ')
    // Zero-Width-Zeichen (z.B. fuehrendes U+200B aus dem Editor) raus.
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// data:image/<type>;base64,<data> -> Buffer + Extension
function parseDataUri(uri) {
  const m = uri.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!m) return null;
  return { ext: m[1].toLowerCase().replace('jpeg', 'jpg'), data: Buffer.from(m[2], 'base64') };
}

// Extrahiert data:-Image-URIs, ersetzt durch relative Pfade <name>_files/imageNNN.<ext>.
function extractInlineImages(html, signatureName) {
  const images = [];
  let counter = 0;
  const replaced = html.replace(/(<img\b[^>]*\bsrc=)(["'])(data:image\/[^"']+)\2/gi, (_, head, q, uri) => {
    const parsed = parseDataUri(uri);
    if (!parsed) return `${head}${q}${uri}${q}`;
    counter += 1;
    const remoteName = `image${String(counter).padStart(3, '0')}.${parsed.ext}`;
    images.push({ remoteName, buffer: parsed.data });
    return `${head}${q}${signatureName}_files/${remoteName}${q}`;
  });
  return { html: replaced, images };
}

// Strippt Tailwind-Preflight-Reste aus inline-styles, die beim Copy-Paste
// aus einer Tailwind-gerenderten Seite im Template landen koennen. In der
// Live-Preview neutralisiert Tailwinds Preflight (`*` → border-width:0) das
// Problem, in Outlook/Word nicht: dort fuehrt die Kombi
// "border-style:solid; border-color:rgb(229,231,235); border-width:0px" mitten
// in zig `--tw-*` Custom-Properties zu einem sichtbaren grauen Rahmen, weil
// Word das `border-width:0px` haeufig verschluckt und nur Style+Color uebrig
// laesst → Default-`medium`-Width.
//
// Heuristik: nur wenn `border-color: rgb(229,231,235)` (Tailwind slate-200,
// Standard-Border-Farbe) vorhanden ist, werden border-width/-style/-color des
// kompletten Tailwind-Reset-Tripels entfernt. Eigene Tabellen- oder Trenn-
// Linien des Benutzers bleiben dadurch unangetastet. Zusaetzlich werden die
// reinen `--tw-*` Custom-Properties geloescht (in Outlook ohnehin inert,
// reduzieren aber die Datei massiv).
function stripTailwindArtifacts(html) {
  return String(html || '').replace(/style="([^"]*)"/g, (full, style) => {
    let s = style;
    // 1) Tailwind-Custom-Properties raus
    s = s.replace(/--tw-[a-zA-Z-]+:[^;"]*;?/g, '');
    // 2) Wenn das Tailwind-Reset-Border-Tripel drin ist, alle drei Decls entfernen
    if (/border-color:\s*rgb\(\s*229\s*,\s*231\s*,\s*235\s*\)/i.test(s)) {
      s = s.replace(/border-width:\s*0(?:px)?\s*;?/gi, '');
      s = s.replace(/border-style:\s*solid\s*;?/gi, '');
      s = s.replace(/border-color:\s*rgb\(\s*229\s*,\s*231\s*,\s*235\s*\)\s*;?/gi, '');
    }
    // 3) Doppelte/leere Semikolons + leading/trailing Whitespace aufraeumen
    s = s.replace(/;\s*;+/g, ';').replace(/^\s*;\s*/, '').replace(/\s*;\s*$/, '');
    if (!s.trim()) return '';
    return `style="${s}"`;
  });
}

// Kodiert alle Nicht-ASCII-Zeichen (Umlaute, ß, €, …) als numerische HTML-Entities
// (z.B. Ü -> &#220;). Damit wird die komplette .htm reines ASCII: egal mit welcher
// Codepage Outlook die Datei beim Reply/Forward interpretiert, der HTML-Parser loest
// &#NNN; immer korrekt auf. Bulletproof gegen Mojibake, BOM-unabhaengig.
// for..of iteriert ueber Code Points (Surrogate-Paare/Emoji bleiben intakt).
function encodeNonAscii(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0);
    out += cp > 127 ? `&#${cp};` : ch;
  }
  return out;
}

// HTML in Outlook-kompatiblen Document-Wrapper packen.
function wrapHtmlDocument(bodyHtml, signatureName) {
  const safeName = signatureName.replace(/[<>&"]/g, '');
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="Generator" content="M365 Signature Manager">
<title>${safeName}</title>
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
</style>
</head>
<body lang="DE-DE">
${bodyHtml}
</body>
</html>
`;
}

// --- Windows-1252 (CP1252) Encoder fuer die .txt -----------------------------
// Outlook liest Plain-Text-Signaturen (.txt aus dem Signatures-Ordner) NICHT als
// UTF-8, sondern in der System-ANSI-Codepage (auf deutschem Windows CP1252) und
// ignoriert einen UTF-8-BOM. Eine als UTF-8 geschriebene .txt fuehrt dadurch zu
// Mojibake: der BOM wird zu "", jeder Umlaut zu zwei Zeichen (ü -> "Ã¼",
// ä -> "Ã¤", ß -> "ÃŸ", € -> "â‚¬"). Deshalb schreiben wir die .txt als echte
// CP1252-Bytes OHNE BOM — exakt das Format, das Outlook selbst erzeugt.
//
// CP1252 == Latin-1 (ISO-8859-1) AUSSER im Bereich 0x80–0x9F, wo CP1252 typo-
// grafische Zeichen (€ „ " ' – — • … usw.) einsortiert. Diese Map bildet genau
// jene Codepoints auf ihr CP1252-Byte ab. Alles andere: 0x00–0xFF direkt als Byte,
// haeufige nicht-CP1252-Zeichen transliteriert, Rest -> "?".
const CP1252_HIGH = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};
// Zeichen, die NICHT in CP1252 existieren, aber sinnvoll als ASCII darstellbar sind.
const CP1252_TRANSLIT = {
  0x2011: '-', 0x2012: '-', 0x2015: '-', // diverse Bindestriche/Striche
  0x00AD: '',                            // Soft-Hyphen -> weg
  0x2007: ' ', 0x2008: ' ', 0x2009: ' ', 0x202F: ' ', 0x2060: '', // schmale/feste Spaces
  0x2032: "'", 0x2033: '"',              // Prime/Doppel-Prime
  0x2192: '->', 0x2190: '<-',            // Pfeile
};

// String -> Buffer mit CP1252-Bytes.
function cp1252Encode(s) {
  const bytes = [];
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF && !(cp >= 0x80 && cp <= 0x9F)) {
      // 0x00–0x7F und 0xA0–0xFF sind in CP1252 identisch mit dem Codepoint.
      bytes.push(cp);
    } else if (CP1252_HIGH[cp] !== undefined) {
      bytes.push(CP1252_HIGH[cp]);
    } else if (CP1252_TRANSLIT[cp] !== undefined) {
      for (const c of CP1252_TRANSLIT[cp]) bytes.push(c.charCodeAt(0));
    } else {
      // Nicht darstellbar (z.B. Emoji, exotische Symbole) -> Platzhalter.
      bytes.push(0x3F); // '?'
    }
  }
  return Buffer.from(bytes);
}

// Escaped Plain Text fuer RTF. Sonderzeichen \ { } werden escaped, Zeilenumbrueche
// zu \par, und JEDES Nicht-ASCII-Zeichen zu einem `\uNNNN?`-Unicode-Escape (NNNN als
// signed 16-bit, passend zum \uc1 im Header). Grund: die Datei wird als UTF-8 auf die
// Platte geschrieben, der RTF-Header deklariert aber ansicpg1252 — rohe UTF-8-Bytes
// wuerden von Word als CP1252 fehlinterpretiert (ü -> "Ã¼", NBSP -> "Â "). Mit \u-Escapes
// ist der RTF-Body reines ASCII und Word rendert Umlaute/Sonderzeichen korrekt.
function rtfEscapeText(s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (ch === '\\') { out += '\\\\'; continue; }
    if (ch === '{') { out += '\\{'; continue; }
    if (ch === '}') { out += '\\}'; continue; }
    if (ch === '\n') { out += '\\par\n'; continue; }
    const cp = ch.codePointAt(0);
    if (cp > 127) {
      if (cp > 0xFFFF) {
        // Supplementary plane -> Surrogate-Paar als zwei \u-Escapes
        const c = cp - 0x10000;
        out += `\\u${0xD800 + (c >> 10)}?\\u${0xDC00 + (c & 0x3FF)}?`;
      } else {
        // RTF erwartet signed 16-bit: Werte >= 32768 negativ darstellen
        out += `\\u${cp >= 0x8000 ? cp - 0x10000 : cp}?`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

// Erkennt "Spalten-Zeilen" (Label + Lücke + Wert) und richtet sie mit echten RTF-Tab-
// Stops aus, statt sich auf Leerzeichen-Padding zu verlassen (das in proportionaler
// Calibri nie sauber fluchtet). Eine Zeile gilt als Spalten-Zeile, wenn sie auf
//   <Label, max. 19 Zeichen><2+ Leerzeichen><Wert>
// passt. Das 19-Zeichen-Cap filtert Fließtext automatisch (z.B. "Eurobaustoff-Nr.:
// 51177  -  EK..." hat ein 23-Zeichen-Label vor der ersten Lücke → keine Spalte).
const RTF_COL_RE = /^(\S.{0,18}?) {2,}(\S.*)$/;
// Konservative Zeichenbreite (Calibri 11pt) zum Bemessen des Tab-Stops. Bewusst
// überschätzt, damit jedes Label SICHER vor dem Tab-Stop endet (sonst springt der Tab
// zum nächsten Stop und die Spalte verrutscht). +Lücke als Mindestabstand zum Wert.
const RTF_CHAR_TWIPS = 140;
const RTF_TAB_GAP_TWIPS = 250;
const RTF_PARA = '\\sa200\\sl276\\slmult1\\f0\\fs22';

function buildRtf(plainText) {
  const lines = String(plainText || '').split('\n');

  // Pro Zeile den Tab-Stop (twips) bestimmen: aufeinanderfolgende Spalten-Zeilen bilden
  // einen Block und teilen sich einen Tab-Stop, bemessen am längsten Label im Block.
  const tabTwips = new Array(lines.length).fill(0);
  for (let i = 0; i < lines.length; ) {
    if (!RTF_COL_RE.test(lines[i])) { i++; continue; }
    let j = i, maxLabel = 0;
    while (j < lines.length && RTF_COL_RE.test(lines[j])) {
      maxLabel = Math.max(maxLabel, lines[j].match(RTF_COL_RE)[1].length);
      j++;
    }
    const tw = maxLabel * RTF_CHAR_TWIPS + RTF_TAB_GAP_TWIPS;
    for (let k = i; k < j; k++) tabTwips[k] = tw;
    i = j;
  }

  const body = lines.map((line, idx) => {
    if (tabTwips[idx]) {
      const m = line.match(RTF_COL_RE);
      // Lücke wird durch echten \tab ersetzt; Tab-Stop steht in den Paragraph-Props.
      return `\\pard${RTF_PARA}\\tx${tabTwips[idx]} ${rtfEscapeText(m[1])}\\tab ${rtfEscapeText(m[2])}\\par`;
    }
    return `\\pard${RTF_PARA} ${rtfEscapeText(line)}\\par`;
  }).join('\n');

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}}
{\\colortbl ;\\red0\\green0\\blue0;}
\\viewkind4\\uc1
${body}
}`;
}

// CMD-Skript fuer den User-Startup-Ordner. Setzt unsere Signatur als Outlook-Standard
// fuer NEUE Mails und deaktiviert das Cloud-Roaming, damit Outlook die lokal deployte
// .htm tatsaechlich verwendet. Idempotent bei jedem Login.
//
// WICHTIG: Die Reply/Forward-Signatur (`ReplySignature`) wird BEWUSST NICHT gesetzt.
// Jeder User soll in Outlook selbst entscheiden, ob Antworten/Weiterleitungen eine
// Signatur bekommen. Wuerde das Skript ReplySignature bei jedem Login erzwingen,
// waere die Auswahl des Users dauerhaft ueberschrieben. Die zentrale Verwaltung
// gilt also nur fuer neue Mails. (Hinweis: das eigentliche "ausgegraut" der
// Outlook-UI kommt von tenantweiten Roaming-Signaturen — dauerhaft behoben erst
// durch scripts/disable-roaming-signatures.ps1 gegen den M365-Tenant.)
//
// Reihenfolge ist wichtig:
// 1) Outlook hart beenden — ein laufender Outlook hat den Cloud-Sync-Thread schon
//    initialisiert und holt die alte Signatur zurueck, bevor DisableRoamingSignatures
//    wirksam wird. Beim Login meist no-op, schadet aber nicht.
// 2) Cloud-Roaming deaktivieren — MUSS vor NewSignature passieren, sonst syncen die
//    Cloud-Files unsere lokalen .htm weg.
// 3) NewSignature (nur neue Mails) auf den deployten Namen setzen.
export function buildSetDefaultSignatureScript(signatureName) {
  // Anfuehrungszeichen im Signatur-Namen wuerden den reg-add-Aufruf brechen.
  const safe = (signatureName || 'Firma_Standard').replace(/["']/g, '');
  const lines = [
    '@echo off',
    'REM Auto-generated by M365 Signature Manager - wird beim naechsten Deploy ueberschrieben.',
    'REM Schritt 1: Outlook hart beenden (sonst behaelt der laufende Roaming-Sync die alte Signatur).',
    'taskkill /im OUTLOOK.EXE /f >nul 2>&1',
    'taskkill /im olk.exe /f >nul 2>&1',
    'REM Schritt 2: Cloud-Roaming deaktivieren - MUSS vor NewSignature passieren.',
    'reg add "HKCU\\Software\\Microsoft\\Office\\16.0\\Outlook\\Setup" /v DisableRoamingSignatures /t REG_DWORD /d 1 /f >nul 2>&1',
    'reg add "HKCU\\Software\\Microsoft\\Office\\16.0\\Outlook\\Setup" /v DisableRoamingSignaturesTemporaryToggle /t REG_DWORD /d 1 /f >nul 2>&1',
    'REM Schritt 3: Default-Signatur NUR fuer neue Mails. ReplySignature bleibt bewusst ungesetzt,',
    'REM damit der User Antworten/Weiterleitungen selbst in Outlook steuern kann.',
    `reg add "HKCU\\Software\\Microsoft\\Office\\16.0\\Common\\MailSettings" /v NewSignature /t REG_SZ /d "${safe}" /f >nul 2>&1`,
    'exit /b 0',
    '',
  ];
  // Windows-CMD will CRLF.
  return lines.join('\r\n');
}

// Haupt-Funktion: erzeugt alle Outlook-Signatur-Dateien aus gerendertem HTML.
// Liefert { htm: string, txt: Buffer, rtf: string, images: [{remoteName, buffer}] }
//
// Bilder (data:-URIs) werden als <name>_files/imageNNN.<ext> heraus extrahiert
// und im HTM ueber einen RELATIVEN Pfad referenziert. Grund: die Word-HTML-Engine,
// die Outlook beim Einfuegen in Antworten/Weiterleitungen verwendet, rendert
// inline data:-URI-Bilder nicht zuverlaessig — die Antwort-Vorschau zeigt dann nur
// leere Platzhalter. Mit separaten _files-Bildern loest Outlook den relativen Pfad
// gegen den Signatures-Ordner auf und wandelt sie beim Versand in CID-Anlagen.
//
// Die .htm bekommt zusaetzlich einen UTF-8-BOM: Outlook ignoriert beim Reply/Forward
// das <meta charset=utf-8> und faellt sonst auf die System-Codepage (CP1252) zurueck
// → Umlaute und geschuetzte Leerzeichen (U+00A0) werden zu Mojibake ("Ä" in den
// Leerzeichen). Der BOM erzwingt die UTF-8-Interpretation zuverlaessig.
export function generateSignatureFiles(renderedHtml, signatureName) {
  const cleaned = stripTailwindArtifacts(renderedHtml || '');
  const { html: withRelImages, images } = extractInlineImages(cleaned, signatureName);
  // Nicht-ASCII -> numerische Entities (Mojibake-sicher), dann BOM voran (G\u00FCrtel+Hosentr\u00E4ger).
  const htm = '\uFEFF' + encodeNonAscii(wrapHtmlDocument(withRelImages, signatureName));
  const plain = htmlToText(renderedHtml || '');
  // .txt als echte Windows-1252-Bytes OHNE BOM: Outlook liest Plain-Text-Signaturen
  // in der System-ANSI-Codepage (CP1252) und ignoriert einen UTF-8-BOM \u2014 eine UTF-8-
  // .txt wuerde sonst als Mojibake erscheinen (\u00FC -> "\u00C3\u00BC", BOM -> ""). Siehe
  // cp1252Encode(). RTF nutzt den Text als \u-Escapes (eigene ASCII-Kodierung).
  const txt = cp1252Encode(plain);
  const rtf = buildRtf(plain);
  return { htm, txt, rtf, images };
}
