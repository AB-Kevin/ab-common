'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const abApps = require('../src/abapps');

const MARY = '0dbc309a-4814-4490-a9ca-0691c9092199';
const BEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** A test AB Apps profile and folder, with AB_APPS_PROFILE pointing at the profile. */
function setUp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-common-abapps-'));
  const profile = path.join(root, 'profile');
  const dataDir = path.join(root, 'AB Apps');
  fs.mkdirSync(profile);
  fs.mkdirSync(path.join(dataDir, 'shared'), { recursive: true });
  process.env.AB_APPS_PROFILE = profile;
  t.after(() => delete process.env.AB_APPS_PROFILE);
  const identity = { version: 1, personId: MARY, name: '  Mary   Manager ', class: 'manager', signedInAt: '2026-10-12T20:00:00.000Z', dataDir };
  const writeIdentity = (value) => fs.writeFileSync(abApps.identityPath('unused'), typeof value === 'string' ? value : JSON.stringify(value));
  const writeShared = (name, value) => fs.writeFileSync(path.join(dataDir, 'shared', name), typeof value === 'string' ? value : JSON.stringify(value));
  return { dataDir, identity, writeIdentity, writeShared };
}

test('who is signed in to AB Apps is read from its identity file, tidied', (t) => {
  const { dataDir, identity, writeIdentity } = setUp(t);
  assert.equal(abApps.readIdentity('unused'), null, 'nobody signed in');
  writeIdentity(identity);
  assert.deepEqual(abApps.readIdentity('unused'), {
    personId: MARY, name: 'Mary Manager', class: 'manager', signedInAt: '2026-10-12T20:00:00.000Z', dataDir,
  });
  assert.equal(abApps.identityPath('C:\\Users\\x\\AppData\\Roaming').startsWith(process.env.AB_APPS_PROFILE), true);
});

test('an identity file that is odd in any way counts as signed out', (t) => {
  const { identity, writeIdentity } = setUp(t);
  for (const changes of [{ version: 2 }, { personId: 'x' }, { name: '  ' }, { name: 'x'.repeat(81) }, { class: 'admin' }, { dataDir: '' }]) {
    writeIdentity({ ...identity, ...changes });
    assert.equal(abApps.readIdentity('unused'), null, JSON.stringify(changes));
  }
  writeIdentity('{ "version": 1, ');
  assert.equal(abApps.readIdentity('unused'), null, 'half written');
});

test('signing in and out is noticed', async (t) => {
  const { identity, writeIdentity } = setUp(t);
  const seen = [];
  const stop = abApps.watchIdentity('unused', (next) => seen.push(next?.name ?? null));
  t.after(stop);
  await new Promise((resolve) => setTimeout(resolve, 500)); // the watcher's first look at the file
  writeIdentity(identity);
  await waitFor(() => seen.length === 1);
  fs.rmSync(abApps.identityPath('unused'));
  await waitFor(() => seen.length === 2);
  assert.deepEqual(seen, ['Mary Manager', null]);
});

test('the people list is read from the AB Apps folder', (t) => {
  const { dataDir, writeShared } = setUp(t);
  writeShared('people.json', { people: [
    { id: MARY, name: 'Mary Manager', class: 'manager', active: true, pin: 'secret' },
    { id: BEN, name: 'Ben Yoder', class: 'unknown', active: false },
    { id: 'not-an-id', name: 'Nobody' },
  ] });
  assert.deepEqual(abApps.readDirectory(dataDir), [
    { id: MARY, name: 'Mary Manager', class: 'manager', active: true },
    { id: BEN, name: 'Ben Yoder', class: 'contractor', active: false },
  ]);
  assert.throws(() => abApps.readDirectory(path.join(dataDir, 'missing')), /can't be found/);
});

test('the shared mail server and website are read, tidied, for whoever is signed in', (t) => {
  const { dataDir, identity, writeIdentity, writeShared } = setUp(t);
  const services = {
    version: 1,
    mail: { host: ' relay.example.org ', port: 25, secure: false, fromName: 'Anabaptist Brotherhood', fromEmail: 'info@example.org' },
    website: { siteUrl: 'https://example.org/', consumerKey: 'ck', consumerSecret: 'cs' },
  };
  writeShared('services.json', `\uFEFF${JSON.stringify(services)}`);
  const expected = {
    mail: { host: 'relay.example.org', port: 25, secure: false, fromName: 'Anabaptist Brotherhood', fromEmail: 'info@example.org' },
    website: { siteUrl: 'https://example.org', consumerKey: 'ck', consumerSecret: 'cs' },
  };
  assert.deepEqual(abApps.readServices(dataDir), expected);
  assert.deepEqual(abApps.sharedServices('unused'), { mail: null, website: null }, 'nobody signed in');
  writeIdentity(identity);
  assert.deepEqual(abApps.sharedServices('unused'), expected);

  writeShared('services.json', { ...services, mail: { ...services.mail, fromEmail: '' }, website: { ...services.website, siteUrl: 'http://example.org' } });
  assert.deepEqual(abApps.readServices(dataDir), { mail: null, website: null }, 'incomplete, or not https');
  writeShared('services.json', { ...services, version: 2 });
  assert.deepEqual(abApps.readServices(dataDir), { mail: null, website: null }, 'a version it doesn\'t know');
  writeShared('services.json', '{ damaged');
  assert.deepEqual(abApps.readServices(dataDir), { mail: null, website: null }, 'damaged');
});

test('AB Apps is found where its installer registered it', async () => {
  const query = async (key) => (key === 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + require('../src/installs').appGuid('org.anabaptistbrotherhood.abapps')
    ? '    UninstallString    REG_SZ    "C:\\Users\\jane\\AppData\\Local\\Programs\\AB Apps\\Uninstall AB Apps.exe" /currentuser\n'
    : null);
  assert.equal(await abApps.findABApps({ query, exists: () => true }), 'C:\\Users\\jane\\AppData\\Local\\Programs\\AB Apps\\AB Apps.exe');
  assert.equal(await abApps.findABApps({ query: async () => null }), null);
});

async function waitFor(condition, ms = 8000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
