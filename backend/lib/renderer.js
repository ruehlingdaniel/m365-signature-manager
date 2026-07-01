import sanitizeHtml from 'sanitize-html';
import { getSetting } from './db.js';

const SANITIZE_OPTS = {
  allowedTags: [
    'a', 'b', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'hr', 'i', 'img', 'li', 'ol',
    'p', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    '*': ['style', 'align', 'class', 'id', 'dir'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'border'],
    table: ['width', 'cellpadding', 'cellspacing', 'border', 'role'],
    td: ['width', 'valign', 'colspan', 'rowspan'],
    th: ['width', 'valign', 'colspan', 'rowspan'],
    font: ['color', 'size', 'face'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data', 'cid'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function sanitize(html) {
  return sanitizeHtml(html || '', SANITIZE_OPTS);
}

// Keys, deren Werte direkt als HTML eingefuegt werden (kein Escape).
// Aktuell nur "logo" — bekommt vom Renderer ein <img>-Tag injiziert.
const RAW_KEYS = new Set(['logo']);

function lookup(context, key) {
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), context);
}

function isTruthy(value) {
  if (value == null) return false;
  return String(value).trim() !== '';
}

// {{#if key}}...{{/if}} und {{#unless key}}...{{/unless}} (auch verschachtelt).
// Negative Lookahead im Body sorgt dafuer, dass innerste Bloecke zuerst matchen —
// damit nested if/unless korrekt nach innen abgewickelt wird.
function processConditionals(html, context) {
  const re = /\{\{#(if|unless)\s+([a-zA-Z0-9_.]+)\s*\}\}((?:(?!\{\{#(?:if|unless)\b)[\s\S])*?)\{\{\/\1\}\}/g;
  let prev;
  let out = String(html || '');
  do {
    prev = out;
    out = out.replace(re, (_, kind, key, inner) => {
      const truthy = isTruthy(lookup(context, key));
      const show = kind === 'if' ? truthy : !truthy;
      return show ? inner : '';
    });
  } while (out !== prev);
  return out;
}

// Aufraeumarbeiten nach Substitution:
// - leere Inline-Wrapper entfernen (z.B. <span></span> aus leerem Platzhalter)
// - <br/>s am Block-Anfang strippen (entstehen, wenn die ersten Platzhalter
//   leer sind und nach Empty-Inline-Cleanup nur noch ein verwaister <br/> uebrig
//   bleibt). Iterativ, damit Empty-Span und BR-Trimm sich gegenseitig triggern.
// Bewusst NICHT getrimmt: <br/>s am Block-Ende — die koennen vom Benutzer
// gewollt sein, um eine Absatz-Luecke vor dem naechsten Element (z.B. Logo)
// zu erzeugen.
function cleanupEmptyArtifacts(html) {
  let out = String(html || '');
  let prev;
  do {
    prev = out;
    out = out.replace(/<(span|font|b|strong|em|i|u)\b[^>]*>(?:\s|&nbsp;|&#160;|&#8203;|&zwnj;|​)*<\/\1>/gi, '');
    out = out.replace(/(<(?:td|th|p|div|li)[^>]*>)\s*(?:<br\s*\/?\s*>\s*)+/gi, '$1');
  } while (out !== prev);
  return out;
}

const SIG_OPT_MARKER = '<!--SIG-OPT-->';

// Bloecke (p/div/li/h1-h6), die mind. einen {{placeholder}} enthalten, werden
// markiert. So koennen wir spaeter erkennen, ob ein Block durch leere
// Platzhalter-Substitution leer geworden ist — und nur in diesem Fall die Zeile
// entfernen. Absichtlich leere Spacer-Bloecke (<p><br/></p> ohne Placeholder)
// bleiben dadurch erhalten.
function markPlaceholderBlocks(html) {
  return String(html || '').replace(
    /<(p|div|li|h[1-6])\b([^>]*)>((?:(?!<\1\b)[\s\S])*?)<\/\1>/gi,
    (match, tag, attrs, inner) => {
      if (!/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(inner)) return match;
      if (inner.includes(SIG_OPT_MARKER)) return match;
      return `<${tag}${attrs}>${SIG_OPT_MARKER}${inner}</${tag}>`;
    },
  );
}

// Pruefen, ob der "sichtbare" Inhalt eines Blocks leer ist: <br>, &nbsp;,
// zero-width chars und leere Inline-Wrapper (span/font/b/strong/em/i/u) werden
// rekursiv abgeraeumt; bleibt etwas uebrig → Block hat echten Inhalt.
function isBlockVisuallyEmpty(inner) {
  let s = String(inner || '');
  let prev;
  do {
    prev = s;
    s = s.replace(/<br\s*\/?\s*>/gi, '');
    s = s.replace(/&nbsp;|&#160;|&#x200B;|&#8203;|&zwnj;|&#8204;/gi, '');
    s = s.replace(/[ ​‌﻿]/g, '');
    // Leere Inline-Wrapper entfernen (kann sich nach dem Strippen ergeben)
    s = s.replace(/<(span|font|b|strong|em|i|u)\b[^>]*>\s*<\/\1>/gi, '');
    s = s.trim();
  } while (s !== prev);
  return s === '';
}

// Markierte Bloecke nach der Substitution auswerten: leere weg, sonst Marker
// entfernen. Iterativ, damit das auch nach Entfernen innerer Bloecke noch
// einmal greift (z.B. <div> wird leer, weil enthaltener <p> entfernt wurde
// — aber nur, wenn das <div> selbst markiert war, sonst bleibt es).
function dropEmptyMarkedBlocks(html) {
  const re = /<(p|div|li|h[1-6])\b([^>]*)>((?:(?!<\1\b)[\s\S])*?)<\/\1>/gi;
  let out = String(html || '');
  let prev;
  do {
    prev = out;
    out = out.replace(re, (match, tag, attrs, inner) => {
      const idx = inner.indexOf(SIG_OPT_MARKER);
      if (idx === -1) return match;
      const after = inner.slice(0, idx) + inner.slice(idx + SIG_OPT_MARKER.length);
      if (isBlockVisuallyEmpty(after)) return '';
      return `<${tag}${attrs}>${after}</${tag}>`;
    });
  } while (out !== prev);
  // Falls ein Marker durch Verschachtelung uebrig geblieben ist, raus damit.
  return out.split(SIG_OPT_MARKER).join('');
}

// Entfernt <br />s, die direkt an leeren Platzhaltern haengen — vor der
// Substitution, damit nur "verwaiste" BRs (die durch leere Platzhalter ueber-
// fluessig werden) verschwinden. Strukturelle BRs (z.B. <br /><br /> am Ende
// eines Blocks, das eine Absatz-Luecke vor dem naechsten Element erzeugt) bleiben.
//
// Drei Muster:
//   1) "{{a}}<br />{{b}}" direkt benachbart — BR weg wenn einer leer
//   2) "{{a}}<br />" an Inline/Block-Grenze (nur schliessende Inline-Tags
//      bis zum naechsten Block-Close) — BR weg wenn a leer
//   3) "<br />{{a}}" an Inline/Block-Grenze (nur oeffnende Inline-Tags vom
//      letzten Block-Open) — BR weg wenn a leer
function dropPlaceholderBrs(html, context) {
  function isEmpty(key) {
    const v = lookup(context, key);
    return v == null || String(v).trim() === '';
  }

  let out = String(html || '');
  let prev;
  do {
    prev = out;

    // 1) {{a}}<br />{{b}} direkt benachbart
    out = out.replace(
      /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*<br\s*\/?\s*>\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
      (full, a, b) => (isEmpty(a) || isEmpty(b)) ? `{{${a}}}{{${b}}}` : full,
    );

    // 2) {{a}}<br /> gefolgt von schliessenden Inline-Tags und dann Block-Close
    out = out.replace(
      /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}((?:\s|<\/(?:span|font|b|strong|em|i|u)[^>]*>)*)<br\s*\/?\s*>((?:\s|<\/(?:span|font|b|strong|em|i|u)[^>]*>)*<\/(?:p|div|li|td|th)>)/g,
      (full, key, mid, tail) => isEmpty(key) ? `{{${key}}}${mid}${tail}` : full,
    );

    // 3) Block-Open + <br /> + {{a}} (a leer)
    out = out.replace(
      /(<(?:p|div|li|td|th)[^>]*>(?:\s|<(?:span|font|b|strong|em|i|u)[^>]*>)*)<br\s*\/?\s*>((?:\s|<(?:span|font|b|strong|em|i|u)[^>]*>)*)\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
      (full, head, mid, key) => isEmpty(key) ? `${head}${mid}{{${key}}}` : full,
    );

  } while (out !== prev);
  return out;
}

// Replace {{variable}} placeholders with values from context
export function renderTemplate(html, context) {
  const conditionsResolved = processConditionals(html, context);
  const brsReduced = dropPlaceholderBrs(conditionsResolved, context);
  const marked = markPlaceholderBlocks(brsReduced);
  const replaced = marked.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const value = lookup(context, key);
    if (value == null || value === '') return '';
    if (RAW_KEYS.has(key)) return String(value); // raw insert
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  });
  const trimmedBlocks = dropEmptyMarkedBlocks(replaced);
  return cleanupEmptyArtifacts(trimmedBlocks);
}

// Liefert den HTML-Snippet fuer das zentrale Firmenlogo, basierend auf
// Setting `company_logo_asset_id` + `company_logo_width`. Liefert "" wenn nicht gesetzt.
export function getLogoHtml() {
  const assetId = getSetting('company_logo_asset_id');
  if (!assetId) return '';
  const width = parseInt(getSetting('company_logo_width') || '150', 10);
  const altText = getSetting('company_logo_alt') || 'Logo';
  return `<img src="/api/assets/${assetId}/file" alt="${altText.replace(/"/g, '&quot;')}" style="max-width:${width}px;height:auto;" />`;
}

// Build the context dict from a signature_users row
export function buildContext(user) {
  if (!user) return {};
  let custom = {};
  try { custom = JSON.parse(user.custom_fields || '{}'); } catch {}
  return {
    displayName: user.display_name || '',
    nameSuffix: user.name_suffix || '',
    windowsUsername: user.windows_username || '',
    jobTitle: user.job_title || '',
    department: user.department || '',
    company: user.company || '',
    office: user.office_location || '',
    email: user.email || '',
    phone: user.phone || '',
    mobile: user.mobile || '',
    fax: user.fax || '',
    street: user.street || '',
    city: user.city || '',
    postalCode: user.postal_code || '',
    country: user.country || '',
    website: user.website || '',
    logo: getLogoHtml(),
    ...custom,
  };
}

export const AVAILABLE_VARIABLES = [
  { key: 'logo', label: 'Firmenlogo (zentral)' },
  { key: 'displayName', label: 'Vollstaendiger Name' },
  { key: 'nameSuffix', label: 'Namens-Zusatz (z.B. ppa., Betriebswirt)' },
  { key: 'jobTitle', label: 'Position / Titel' },
  { key: 'department', label: 'Abteilung' },
  { key: 'company', label: 'Firma' },
  { key: 'office', label: 'Buero / Standort' },
  { key: 'email', label: 'E-Mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'mobile', label: 'Mobil' },
  { key: 'fax', label: 'Fax' },
  { key: 'street', label: 'Strasse' },
  { key: 'city', label: 'Stadt' },
  { key: 'postalCode', label: 'PLZ' },
  { key: 'country', label: 'Land' },
  { key: 'website', label: 'Webseite' },
];
