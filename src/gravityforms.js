'use strict';

// The website's Gravity Forms REST API (v2), read with a consumer key and
// secret. `connection` is { siteUrl, consumerKey, consumerSecret, formId }:
// an app's own, or AB Apps' website (abapps.sharedServices) plus the app's
// form. Every call only reads, so a key with Read permission is enough.
//
// The API accepts HTTP Basic Auth over HTTPS (consumer key as user name,
// secret as password) instead of OAuth 1 request signing -- see
// docs.gravityforms.com. Basic Auth sends the key and secret with every
// request, so only https is allowed.
//
// `fetch` defaults to Node's own; pass Electron's net.fetch to use Windows'
// proxy settings.

async function gfFetch({ siteUrl, consumerKey, consumerSecret }, endpoint, { fetch = globalThis.fetch } = {}) {
  if (!/^https:\/\//i.test(siteUrl || '')) throw new Error('The site URL has to start with https://.');
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const base = siteUrl.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}/wp-json/gf/v2/${endpoint}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`The website couldn't be reached: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Gravity Forms answered ${res.status} for ${endpoint.split('?')[0]}. Check the site URL and the key and secret.`);
  }
  return res.json();
}

/** The site's forms, as [{ id, title }]. Also a good test of a connection. */
async function listForms(connection, options) {
  const forms = await gfFetch(connection, 'forms', options);
  // Some Gravity Forms versions answer with an object keyed by id instead of an array.
  const list = Array.isArray(forms) ? forms : Object.values(forms || {});
  return list.map((f) => ({ id: String(f.id), title: f.title || `Form ${f.id}` }));
}

/** The form itself, with its fields. */
async function fetchForm(connection, options) {
  return gfFetch(connection, `forms/${encodeURIComponent(connection.formId)}`, options);
}

// The list-entries response is a bare array on some Gravity Forms versions
// and an { entries, total_count } wrapper on others.
function normalizeEntriesResponse(raw) {
  if (Array.isArray(raw)) return { entries: raw, totalCount: null };
  if (raw && Array.isArray(raw.entries)) return { entries: raw.entries, totalCount: Number(raw.total_count) || null };
  return { entries: [], totalCount: 0 };
}

const PAGE_SIZE = 200;
const MAX_PAGES = 100;

/**
 * The form's active entries (not spam or trash), newest first, stopping at
 * the first one at or below `afterId` -- entry IDs only ever go up, so with
 * the highest ID seen last time, that's every entry since.
 */
async function fetchEntries(connection, afterId = 0, options) {
  const collected = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = await gfFetch(
      connection,
      `forms/${encodeURIComponent(connection.formId)}/entries?paging[page_size]=${PAGE_SIZE}&paging[current_page]=${page}&sorting[key]=id&sorting[direction]=DESC`,
      options,
    );
    const { entries, totalCount } = normalizeEntriesResponse(raw);
    for (const entry of entries) {
      if (Number(entry.id) <= afterId) return collected;
      collected.push(entry);
    }
    if (entries.length < PAGE_SIZE || (totalCount !== null && page * PAGE_SIZE >= totalCount)) break;
  }
  return collected;
}

module.exports = { gfFetch, listForms, fetchForm, normalizeEntriesResponse, fetchEntries };
