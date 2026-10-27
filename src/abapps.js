'use strict';

// What the office's apps take from AB Apps, the launcher that signs people in
// once for every app. While someone is signed in, AB Apps keeps who it is in
// this Windows account's AppData:
//
//   %APPDATA%\AB Apps\identity.json
//   { "version": 1, "personId", "name", "class", "signedInAt", "dataDir" }
//
// `dataDir` is the shared AB Apps folder, which holds:
//
//   shared/people.json     everyone: { people: [{ id, name, class, active, … }] }
//   shared/services.json   the mail server and website a manager set on AB
//                          Apps' Mail and website page:
//                          { "version": 1, "mail", "website" }
//
// Everything here is null when AB Apps isn't installed, nobody is signed in,
// a manager hasn't set it, or a file can't be read -- and then an app uses its
// own sign-in or settings, so it still works without AB Apps. Like AB Apps'
// PIN, this is a convenience, not a security boundary: anyone using the
// Windows account, or with the shared folder, can change these files.

const fs = require('fs');
const path = require('path');
const { readJson } = require('./jsonfile');
const { findInstall } = require('./installs');

const CLASSES = ['manager', 'employee', 'contractor'];
const AB_APPS = { appId: 'org.anabaptistbrotherhood.abapps', productName: 'AB Apps' };

/** AB Apps' folder in AppData, or AB_APPS_PROFILE, which AB Apps also honors, for test runs. */
const identityDir = (appDataDir) => process.env.AB_APPS_PROFILE || path.join(appDataDir, 'AB Apps');
/** `appDataDir` is Electron's app.getPath('appData'). */
const identityPath = (appDataDir) => path.join(identityDir(appDataDir), 'identity.json');

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Reads a JSON file, or null if it's missing, mid-sync or damaged. */
function readOrNull(file) {
  try {
    return readJson(file, null);
  } catch {
    return null;
  }
}

/** Who is signed in to AB Apps: { personId, name, class, signedInAt, dataDir }, or null. */
function readIdentity(appDataDir) {
  const identity = readOrNull(identityPath(appDataDir));
  if (identity?.version !== 1) return null;
  const name = text(identity.name).replace(/\s+/g, ' ');
  if (!/^[0-9a-f-]{36}$/i.test(identity.personId ?? '') || !name || name.length > 80) return null;
  if (!CLASSES.includes(identity.class) || !text(identity.dataDir)) return null;
  return { personId: identity.personId, name, class: identity.class, signedInAt: identity.signedInAt ?? null, dataDir: identity.dataDir };
}

/**
 * Calls onChange(identity) when someone signs in to AB Apps, signs out, or
 * their AB Apps writes a new name, checking every two seconds. Returns a
 * function that stops it.
 */
function watchIdentity(appDataDir, onChange) {
  const file = identityPath(appDataDir);
  let last = JSON.stringify(readIdentity(appDataDir));
  const check = () => {
    const next = readIdentity(appDataDir);
    if (JSON.stringify(next) === last) return;
    last = JSON.stringify(next);
    onChange(next);
  };
  fs.watchFile(file, { interval: 2000 }, check);
  return () => fs.unwatchFile(file, check);
}

/** Everyone in the AB Apps folder, as { id, name, class, active }. Throws if the folder can't be read. */
function readDirectory(dataDir) {
  const file = path.join(dataDir, 'shared', 'people.json');
  if (!fs.existsSync(file)) throw new Error(`The AB Apps folder ${dataDir} can't be found. If OneDrive is still setting up, wait for it to finish.`);
  return readJson(file, { people: [] }).people
    .filter((p) => /^[0-9a-f-]{36}$/i.test(p?.id ?? '') && typeof p.name === 'string')
    .map((p) => ({ id: p.id, name: p.name, class: CLASSES.includes(p.class) ? p.class : 'contractor', active: Boolean(p.active) }));
}

function cleanMail(mail) {
  const port = Number(mail?.port);
  if (!text(mail?.host) || !text(mail?.fromEmail) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: text(mail.host), port, secure: mail.secure === true, fromName: text(mail.fromName), fromEmail: text(mail.fromEmail) };
}

function cleanWebsite(website) {
  const siteUrl = text(website?.siteUrl).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(siteUrl) || !text(website?.consumerKey) || !text(website?.consumerSecret)) return null;
  return { siteUrl, consumerKey: text(website.consumerKey), consumerSecret: text(website.consumerSecret) };
}

/**
 * The mail server and website in an AB Apps folder: { mail, website }, each
 * null when it isn't set. `mail` is { host, port, secure, fromName,
 * fromEmail }, a server that takes mail without signing in. `website` is {
 * siteUrl, consumerKey, consumerSecret }, a read-only Gravity Forms key.
 */
function readServices(dataDir) {
  const services = readOrNull(path.join(dataDir, 'shared', 'services.json'));
  if (services?.version !== 1) return { mail: null, website: null };
  return { mail: cleanMail(services.mail), website: cleanWebsite(services.website) };
}

/** The mail server and website of the AB Apps folder of whoever is signed in, as readServices gives them. */
function sharedServices(appDataDir) {
  const identity = readIdentity(appDataDir);
  return identity ? readServices(identity.dataDir) : { mail: null, website: null };
}

/** Where AB Apps' program is on this computer, or null. */
async function findABApps(options) {
  return (await findInstall(AB_APPS, options))?.exe ?? null;
}

module.exports = { CLASSES, identityPath, readIdentity, watchIdentity, readDirectory, readServices, sharedServices, findABApps };
