import sanitizeHtml from 'sanitize-html';

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

// Replace {{variable}} placeholders with values from context
export function renderTemplate(html, context) {
  return (html || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), context);
    if (value == null || value === '') return '';
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  });
}

// Build the context dict from a m365_users row
export function buildContext(user) {
  if (!user) return {};
  let custom = {};
  try { custom = JSON.parse(user.custom_fields || '{}'); } catch {}
  return {
    displayName: user.display_name || '',
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
    ...custom,
  };
}

export const AVAILABLE_VARIABLES = [
  { key: 'displayName', label: 'Vollstaendiger Name' },
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
