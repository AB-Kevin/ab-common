'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseVersion, isNewer, parseLatestYml, latestRelease, downloadInstaller, selfUpdates } = require('../src/releases');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ab-common-release-'));
const sha512 = (bytes) => crypto.createHash('sha512').update(bytes).digest('base64');
const DIGEST = sha512('installer');

/** A stand-in for net.fetch that answers every request with `body`, and remembers the URL. */
function fakeFetch(body, { status = 200 } = {}) {
  const fetch = async (url) => {
    fetch.calls++;
    fetch.url = url;
    return new Response(body, { status });
  };
  fetch.calls = 0;
  return fetch;
}

/** A latest.yml as electron-builder writes it. */
function latestYml(version, { name = `BillManager-Setup-${version}.exe`, pathName = name, digest = DIGEST, size = 1234 } = {}) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${digest}`,
    `    size: ${size}`,
    `path: ${pathName}`,
    `sha512: ${digest}`,
    "releaseDate: '2026-10-06T02:30:27.123Z'",
    '',
  ].join('\n');
}

test('versions are compared part by part, as numbers', () => {
  assert.deepEqual(parseVersion('v1.10.0'), [1, 10, 0]);
  assert.equal(parseVersion('1.0'), null);
  assert.equal(parseVersion('v1.1.0-beta.1'), null);
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('nonsense', '1.0.0'), false);
});

test('latest.yml is read without a YAML library', () => {
  assert.deepEqual(parseLatestYml(latestYml('2.2.3').replaceAll('\n', '\r\n')), {
    version: '2.2.3',
    files: [{ url: 'BillManager-Setup-2.2.3.exe', sha512: DIGEST, size: 1234 }],
    path: 'BillManager-Setup-2.2.3.exe',
    sha512: DIGEST,
    releaseDate: '2026-10-06T02:30:27.123Z',
  });
});

test('a repository\'s latest release is read from its download link', async () => {
  const fetch = fakeFetch(latestYml('2.2.3'));
  const release = await latestRelease('AB-Kevin/BillManager', fetch);
  assert.equal(fetch.url, 'https://github.com/AB-Kevin/BillManager/releases/latest/download/latest.yml');
  assert.deepEqual(release, {
    version: '2.2.3',
    publishedAt: '2026-10-06T02:30:27.123Z',
    pageUrl: 'https://github.com/AB-Kevin/BillManager/releases/tag/v2.2.3',
    installer: {
      name: 'BillManager-Setup-2.2.3.exe',
      size: 1234,
      url: 'https://github.com/AB-Kevin/BillManager/releases/download/v2.2.3/BillManager-Setup-2.2.3.exe',
      sha512: DIGEST,
    },
  });
});

test('names with spaces are kept in the download link', async () => {
  const release = await latestRelease('AB-Kevin/X', fakeFetch(latestYml('1.0.0', { name: 'AB Thing Setup 1.0.0.exe' })));
  assert.equal(release.installer.url, 'https://github.com/AB-Kevin/X/releases/download/v1.0.0/AB%20Thing%20Setup%201.0.0.exe');
});

test('only a plain installer that latest.yml points to, with a digest and size, is offered', async () => {
  const check = async (options) => (await latestRelease('AB-Kevin/BillManager', fakeFetch(latestYml('2.2.3', options)))).installer;
  assert.equal(await check({ name: '../evil.exe' }), null);
  assert.equal(await check({ name: 'https://example.com/BillManager-Setup-2.2.3.exe' }), null);
  assert.equal(await check({ name: 'BillManager-Setup-2.2.3.zip' }), null);
  assert.equal(await check({ pathName: 'Other.exe' }), null);
  assert.equal(await check({ digest: '' }), null);
  assert.equal(await check({ size: 'big' }), null);
});

test('problems reaching GitHub are explained', async () => {
  await assert.rejects(latestRelease('AB-Kevin/X', fakeFetch('', { status: 404 })), /No release is ready/);
  await assert.rejects(latestRelease('AB-Kevin/X', fakeFetch('', { status: 429 })), /limiting/);
  await assert.rejects(latestRelease('AB-Kevin/X', fakeFetch('', { status: 500 })), /error 500/);
  await assert.rejects(latestRelease('AB-Kevin/X', async () => { throw new TypeError('fetch failed'); }), /Couldn't reach GitHub/);
  await assert.rejects(latestRelease('AB-Kevin/X', fakeFetch('<html></html>')), /version number/);
});

test('the installer is downloaded, checked against its digest, and reused', async () => {
  const dir = tempDir();
  const bytes = crypto.randomBytes(200000).toString('base64');
  const installer = { name: 'BillManager-Setup-2.2.3.exe', size: bytes.length, url: 'https://x', sha512: sha512(bytes) };
  const fetch = fakeFetch(bytes);
  const progress = [];

  const filePath = await downloadInstaller(installer, dir, fetch, (received, total) => progress.push([received, total]));
  assert.equal(filePath, path.join(dir, installer.name));
  assert.equal(fs.readFileSync(filePath, 'utf8'), bytes);
  assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);

  assert.equal(await downloadInstaller(installer, dir, fetch), filePath);
  assert.equal(fetch.calls, 1);
});

test('a download that doesn\'t match the release is thrown away', async () => {
  const dir = tempDir();
  const installer = { name: 'BillManager-Setup-2.2.3.exe', size: 5, url: 'https://x', sha512: sha512('right') };
  await assert.rejects(downloadInstaller(installer, dir, fakeFetch('wrong')), /didn't match/);
  await assert.rejects(downloadInstaller({ ...installer, size: 99 }, dir, fakeFetch('right')), /didn't match/);
  await assert.rejects(downloadInstaller(installer, dir, fakeFetch('', { status: 500 })), /couldn't be downloaded/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// An app updating itself: only its own installer, by the name it's built with.
const keeptime = selfUpdates({ repo: 'AB-Kevin/contractor-time', installerName: (version) => `KeepTime-Setup-${version}.exe` });

test("an app's newer release is reported with its installer and digest", async () => {
  const fetch = fakeFetch(latestYml('1.2.0', { name: 'KeepTime-Setup-1.2.0.exe' }));
  const result = await keeptime.checkForUpdate('1.0.0', fetch);
  assert.equal(keeptime.RELEASES_PAGE, 'https://github.com/AB-Kevin/contractor-time/releases');
  assert.equal(fetch.url, 'https://github.com/AB-Kevin/contractor-time/releases/latest/download/latest.yml');
  assert.deepEqual(result, {
    version: '1.2.0',
    newer: true,
    publishedAt: '2026-10-06T02:30:27.123Z',
    pageUrl: 'https://github.com/AB-Kevin/contractor-time/releases/tag/v1.2.0',
    installer: {
      name: 'KeepTime-Setup-1.2.0.exe',
      size: 1234,
      url: 'https://github.com/AB-Kevin/contractor-time/releases/download/v1.2.0/KeepTime-Setup-1.2.0.exe',
      sha512: DIGEST,
    },
  });
  assert.equal((await keeptime.checkForUpdate('1.2.0', fakeFetch(latestYml('1.2.0', { name: 'KeepTime-Setup-1.2.0.exe' })))).newer, false);
});

test("an app only takes the installer it's built with, even if latest.yml points elsewhere", async () => {
  const check = async (name) => (await keeptime.checkForUpdate('1.0.0', fakeFetch(latestYml('1.2.0', { name })))).installer;
  assert.equal(await check('Something-else.exe'), null);
  assert.equal(await check('KeepTime-Setup-1.1.0.exe'), null);
  assert.equal(await check('https://example.com/KeepTime-Setup-1.2.0.exe'), null);
});
