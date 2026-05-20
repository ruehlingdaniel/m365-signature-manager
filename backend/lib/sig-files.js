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

// Minimales RTF: Header + escaped Plain Text.
function buildRtf(plainText) {
  const escaped = (plainText || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .split('\n').join('\\par\n');
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}}
{\\colortbl ;\\red0\\green0\\blue0;}
\\viewkind4\\uc1\\pard\\sa200\\sl276\\slmult1\\f0\\fs22 ${escaped}\\par
}`;
}

// Haupt-Funktion: erzeugt alle Outlook-Signatur-Dateien aus gerendertem HTML.
// Liefert { htm: string, txt: string, rtf: string, images: [{remoteName, buffer}] }
export function generateSignatureFiles(renderedHtml, signatureName) {
  const { html: htmlWithFileRefs, images } = extractInlineImages(renderedHtml || '', signatureName);
  const htm = wrapHtmlDocument(htmlWithFileRefs, signatureName);
  const txt = htmlToText(renderedHtml || '');
  const rtf = buildRtf(txt);
  return { htm, txt, rtf, images };
}
