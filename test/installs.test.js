'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appGuid, parseRegQuery, findInstall } = require('../src/installs');

// Keys these apps' installers really created on a Windows computer.
test('the registry key is found from the appId, as electron-builder makes it', () => {
  assert.equal(appGuid('com.billmanager.filemanager'), '6c91edf4-7e1b-53ea-a815-eb892940a809');
  assert.equal(appGuid('org.anabaptistbrotherhood.duplicatechecker'), '34d9e267-78ef-5071-b58d-029b778197d1');
  assert.equal(appGuid('com.formtracker.app'), 'e83cb20f-7f83-507a-994e-dfa31f53d0e4');
});

const BILLMANAGER = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\6c91edf4-7e1b-53ea-a815-eb892940a809
    DisplayName    REG_SZ    BillManager 2.2.3
    UninstallString    REG_SZ    "C:\\Users\\jane\\AppData\\Local\\Programs\\BillManager\\Uninstall BillManager.exe" /currentuser
    DisplayVersion    REG_SZ    2.2.3
    NoModify    REG_DWORD    0x1
`;

test('reg query output is read into its string values', () => {
  const values = parseRegQuery(BILLMANAGER.replaceAll('\n', '\r\n'));
  assert.equal(values.DisplayName, 'BillManager 2.2.3');
  assert.equal(values.DisplayVersion, '2.2.3');
  assert.equal(values.NoModify, undefined);
});

const app = { appId: 'com.billmanager.filemanager', productName: 'BillManager' };

test('a per-user install is found with its version and program', async () => {
  const asked = [];
  const query = async (key) => {
    asked.push(key);
    return key.startsWith('HKCU') ? BILLMANAGER : null;
  };
  const install = await findInstall(app, { query, exists: () => true });
  assert.deepEqual(install, {
    version: '2.2.3',
    scope: 'user',
    dir: 'C:\\Users\\jane\\AppData\\Local\\Programs\\BillManager',
    exe: 'C:\\Users\\jane\\AppData\\Local\\Programs\\BillManager\\BillManager.exe',
  });
  assert.equal(asked[0], 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\6c91edf4-7e1b-53ea-a815-eb892940a809');
});

test('an install for all users is found in HKLM', async () => {
  const query = async (key) => (key.startsWith('HKLM') ? BILLMANAGER.replace('HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE') : null);
  assert.equal((await findInstall(app, { query, exists: () => true })).scope, 'machine');
});

test('an app that isn\'t there, or whose program was deleted, isn\'t installed', async () => {
  assert.equal(await findInstall(app, { query: async () => null, exists: () => true }), null);
  assert.equal(await findInstall(app, { query: async () => BILLMANAGER, exists: () => false }), null);
});
