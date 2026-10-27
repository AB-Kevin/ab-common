'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MOVED_NOTE, appFolder, readMovedNote, chooseFolder, moveToAbApps } = require('../src/appfolder');

function setUp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-common-appfolder-'));
  const abApps = path.join(root, 'AB Apps');
  const own = path.join(root, 'Old place');
  fs.mkdirSync(abApps);
  fs.mkdirSync(own);
  const target = appFolder({ dataDir: abApps }, 'FormTracker');
  const hasData = (dir) => fs.existsSync(path.join(dir, 'contacts.json'));
  const fill = (dir) => {
    fs.mkdirSync(path.join(dir, 'pdf-templates'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'contacts.json'), '[]');
    fs.writeFileSync(path.join(dir, 'pdf-templates', 'a.pdf'), 'pdf');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  };
  return { root, abApps, own, target, hasData, fill };
}

test("the app's folder is its subfolder of the AB Apps folder, while someone is signed in", () => {
  assert.equal(appFolder({ dataDir: 'D:\\AB Apps' }, 'KeepTime'), path.join('D:\\AB Apps', 'KeepTime'));
  assert.equal(appFolder(null, 'KeepTime'), null);
});

test('without AB Apps, an app keeps its own folder', () => {
  const { own, hasData } = setUp();
  assert.deepEqual(chooseFolder({ own, target: null, hasData }), { dir: own, reason: 'own' });
});

test("data still in the app's own folder waits there for a manager to move it", () => {
  const { own, target, hasData, fill } = setUp();
  fill(own);
  assert.deepEqual(chooseFolder({ own, target, hasData }), { dir: own, reason: 'not-moved' });
});

test("a computer with nothing of its own goes straight to the AB Apps folder, but one whose folder hasn't synced waits", () => {
  const { root, own, target, hasData } = setUp();
  assert.deepEqual(chooseFolder({ own, target, hasData }), { dir: target, reason: 'ab-apps' });
  assert.deepEqual(chooseFolder({ own: null, target, hasData }), { dir: target, reason: 'ab-apps' });
  const notSynced = path.join(root, 'Not synced yet');
  assert.deepEqual(chooseFolder({ own: notSynced, target, hasData }), { dir: notSynced, reason: 'not-moved' });
});

test('moving copies everything but what is skipped, leaves the old folder as it was, and sends others there', () => {
  const { own, target, hasData, fill } = setUp();
  fill(own);
  const files = moveToAbApps({ from: own, to: target, folder: 'FormTracker', by: 'Mary Manager', skip: ['settings.json'] });
  assert.equal(files, 2);
  assert.ok(fs.existsSync(path.join(target, 'pdf-templates', 'a.pdf')));
  assert.equal(fs.existsSync(path.join(target, 'settings.json')), false);
  assert.ok(fs.existsSync(path.join(own, 'contacts.json')), 'the old folder keeps its data, as a backup');
  assert.equal(readMovedNote(own).by, 'Mary Manager');
  assert.equal(fs.existsSync(path.join(target, MOVED_NOTE)), false);
  assert.deepEqual(chooseFolder({ own, target, hasData }), { dir: target, reason: 'ab-apps' });
});

test("another computer follows the note even before the data has synced to it", () => {
  const { own, target, hasData, fill } = setUp();
  fill(own);
  fs.writeFileSync(path.join(own, MOVED_NOTE), JSON.stringify({ version: 1, folder: 'FormTracker' }));
  assert.deepEqual(chooseFolder({ own, target, hasData }), { dir: target, reason: 'ab-apps' });
});

test('a move never copies over files already in the AB Apps subfolder', () => {
  const { own, target, fill } = setUp();
  fill(own);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'contacts.json'), '[1]');
  assert.throws(() => moveToAbApps({ from: own, to: target, folder: 'FormTracker' }), /already has files/);
  assert.equal(fs.readFileSync(path.join(target, 'contacts.json'), 'utf8'), '[1]');
  assert.equal(readMovedNote(own), null);
});
