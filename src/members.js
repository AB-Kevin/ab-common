'use strict';

// MemberManager's member list, which FormTracker and SendNewsletters read
// instead of keeping lists of their own. MemberManager keeps it in its
// subfolder of the AB Apps folder:
//
//   <AB Apps folder>\MemberManager\
//     contacts.json      people: { id, name, email, memberId, memberStatus,
//                        orgId, householdId, subs, fields, … }
//     households.json    addresses: { id, addressLine1, addressLine2, city,
//                        state, zip, subs, fields }
//     orgs.json          organizations: { id, name, attn, email, address…,
//                        subs, fields }
//     publications.json  newsletters: { id, name }
//     fields.json        the office's own fields: { id, label, appliesTo:
//                        "contact" | "household" | "org", type }
//     retired.json       records that left the list: { kind, fromId, toId,
//                        snapshot, at } -- toId is the record it was merged
//                        into, or null when it was deleted
//
// Only MemberManager's host computer writes these, so an app only ever reads
// them. A record's own fields are `fields: { [field id]: value }`: dates as
// YYYY-MM-DD, Yes/No as true/false, and a blank field has no entry.
//
// Everything here reads leniently: a file OneDrive is still syncing reads as
// null rather than as an empty list, so an app keeps what it had and tries
// again.

const fs = require('fs');
const path = require('path');
const { readJson } = require('./jsonfile');

const FOLDER = 'MemberManager';
const REQUIRED = ['contacts', 'households', 'orgs', 'publications'];
const OPTIONAL = ['fields', 'retired'];

/**
 * MemberManager's folder in the AB Apps folder of `identity` (readIdentity's),
 * or null when nobody is signed in or MemberManager has no list there yet.
 */
function memberListFolder(identity) {
  if (!identity?.dataDir) return null;
  const folder = path.join(identity.dataDir, FOLDER);
  return fs.existsSync(path.join(folder, 'contacts.json')) ? folder : null;
}

function readList(file, required) {
  try {
    const value = readJson(file, required ? undefined : []);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The whole list: { contacts, households, orgs, publications, fields,
 * retired }, or null when any of it can't be read right now (missing,
 * mid-sync or damaged). `fields` and `retired` are [] until MemberManager
 * has written them.
 */
function readMemberList(folder) {
  if (!folder) return null;
  const list = {};
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const file = path.join(folder, `${name}.json`);
    const required = REQUIRED.includes(name);
    if (!required && !fs.existsSync(file)) {
      list[name] = [];
      continue;
    }
    const rows = readList(file, required);
    if (!rows) return null;
    list[name] = rows;
  }
  return list;
}

// When each file was last written, as one string, to notice a new save.
function signature(folder) {
  return [...REQUIRED, ...OPTIONAL]
    .map((name) => {
      try {
        const stat = fs.statSync(path.join(folder, `${name}.json`));
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return '-';
      }
    })
    .join('|');
}

/**
 * Calls onChange() whenever MemberManager saves its list, checking every
 * `interval` milliseconds (OneDrive doesn't reliably report changes to a
 * watcher). Returns a function that stops it.
 */
function watchMemberList(folder, onChange, { interval = 5000 } = {}) {
  let last = signature(folder);
  const timer = setInterval(() => {
    const next = signature(folder);
    if (next === last) return;
    last = next;
    onChange();
  }, interval);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** A field's stored value as it reads on screen: "Yes", "3/5/2024", or "" for none. */
function formatFieldValue(type, value) {
  if (value === undefined || value === null || value === '') return '';
  if (type === 'yesno') return value ? 'Yes' : 'No';
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(value);
  }
  return String(value);
}

/** A record's values for the fields of one level ("contact", "household" or "org"), by field name, "" where blank. */
function fieldValues(fields, record, appliesTo) {
  const values = {};
  for (const field of fields) {
    if (field.appliesTo === appliesTo) values[field.label] = formatFieldValue(field.type, record?.fields?.[field.id]);
  }
  return values;
}

/**
 * Everyone with a Member ID -- each member household's head -- with their
 * household's address and their organization's name: { id (the person's),
 * householdId, memberId, memberStatus, name, email, addressLine1,
 * addressLine2, city, state, zip, orgName, fields }, where `fields` are the
 * household's and then the person's own, by name.
 */
function members(list) {
  const households = new Map(list.households.map((h) => [h.id, h]));
  const orgs = new Map(list.orgs.map((o) => [o.id, o]));
  const fields = list.fields || [];
  return list.contacts
    .filter((c) => String(c.memberId || '').trim())
    .map((c) => {
      const h = households.get(c.householdId) || {};
      return {
        id: c.id,
        householdId: households.has(c.householdId) ? c.householdId : null,
        memberId: String(c.memberId).trim(),
        memberStatus: c.memberStatus || '',
        name: c.name || '',
        email: c.email || '',
        addressLine1: h.addressLine1 || '',
        addressLine2: h.addressLine2 || '',
        city: h.city || '',
        state: h.state || '',
        zip: h.zip || '',
        orgName: orgs.get(c.orgId)?.name || '',
        fields: { ...fieldValues(fields, h, 'household'), ...fieldValues(fields, c, 'contact') },
      };
    });
}

/**
 * Where a record went: its own id while it's on the list, the id it was
 * merged into (following merges of merges), or null once it was deleted or
 * can't be found. `kind` is "contact", "household" or "org".
 */
function currentId(list, kind, id) {
  const present = new Set(list[{ contact: 'contacts', household: 'households', org: 'orgs' }[kind]].map((r) => r.id));
  const next = new Map(list.retired.filter((r) => r.kind === kind).map((r) => [r.fromId, r.toId || null]));
  const seen = new Set();
  let at = id;
  while (at && !present.has(at)) {
    if (seen.has(at) || !next.has(at)) return null;
    seen.add(at);
    at = next.get(at);
  }
  return at || null;
}

module.exports = { FOLDER, memberListFolder, readMemberList, watchMemberList, formatFieldValue, fieldValues, members, currentId };
