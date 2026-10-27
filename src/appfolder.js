'use strict';

// Each app keeps its data in its own subfolder of the AB Apps folder -- the
// one shared folder each computer chooses once in AB Apps -- and finds it
// there by itself while someone is signed in:
//
//   <AB Apps folder>\KeepTime
//   <AB Apps folder>\FormTracker
//   <AB Apps folder>\SendNewsletters
//   <AB Apps folder>\Duplicate Checker
//   <AB Apps folder>\ApplicationManager
//
// Data that was somewhere else before is moved once, by a manager, from
// inside the app: it's copied into the subfolder, and a note left in the old
// folder sends every other computer there too. The old folder is otherwise
// left as it was, as a backup. Without AB Apps, or with nobody signed in, an
// app uses its own folder setting, as before.

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const MOVED_NOTE = 'moved-to-ab-apps.json';

/** The app's subfolder of the AB Apps folder of whoever is signed in (see abapps.readIdentity), or null. */
function appFolder(identity, name) {
  return identity?.dataDir ? path.join(identity.dataDir, name) : null;
}

const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** The note a move left in a folder: { version, folder, movedAt, by }, or null. */
function readMovedNote(dir) {
  try {
    const note = readJson(path.join(dir, MOVED_NOTE), null);
    return note?.version === 1 ? note : null;
  } catch {
    return null;
  }
}

/**
 * Which folder an app uses: { dir, reason }, where reason is
 * - 'own': no AB Apps folder; the app's own setting
 * - 'ab-apps': its subfolder of the AB Apps folder
 * - 'not-moved': its data is still in its own folder, waiting for a manager
 *   to move it (see moveToAbApps)
 * `own` is the app's own folder setting; `hasData(dir)` says whether a folder
 * holds the app's data.
 */
function chooseFolder({ own, target, hasData }) {
  if (!target) return { dir: own, reason: 'own' };
  if (samePath(own, target) || hasData(target) || readMovedNote(own)) return { dir: target, reason: 'ab-apps' };
  // Nothing to move: a new computer, or one that never had data of its own.
  // A folder that isn't there at all may just not have synced yet, so it's
  // waited for rather than starting afresh in the AB Apps folder.
  if (!own || (fs.existsSync(own) && !hasData(own))) return { dir: target, reason: 'ab-apps' };
  return { dir: own, reason: 'not-moved' };
}

function isEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

/** Copies a folder's contents into another, leaving out names in `skip` (at the top level). */
function copyFolder(from, to, { skip = [] } = {}) {
  fs.mkdirSync(to, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(entry.name) || entry.name === MOVED_NOTE || entry.name.endsWith('.tmp')) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      files += copyFolder(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      files++;
    }
  }
  return files;
}

/**
 * Moves an app's data into its AB Apps subfolder: copies everything in
 * `from` (but `skip`) into `to`, which has to be empty, then leaves the note
 * in `from` that sends other computers there. Nothing in `from` is changed
 * or removed. Returns how many files were copied. The app stops writing to
 * `from` before calling this, and switches to `to` after.
 */
function moveToAbApps({ from, to, folder, by, skip = [] }) {
  if (samePath(from, to)) throw new Error('The data is already in the AB Apps folder.');
  if (!isEmptyDir(to)) throw new Error(`${to} already has files in it, so nothing was copied. If it's the data, moved from another computer, it will be used once OneDrive has synced it.`);
  const files = copyFolder(from, to, { skip });
  writeJson(path.join(from, MOVED_NOTE), { version: 1, folder, movedAt: new Date().toISOString(), by: by || null });
  return files;
}

module.exports = { MOVED_NOTE, appFolder, samePath, readMovedNote, chooseFolder, copyFolder, moveToAbApps };
