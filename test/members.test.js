'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const members = require('../src/members');

/** An AB Apps folder with MemberManager's list in it. */
function setUp(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-common-members-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const folder = path.join(dataDir, 'MemberManager');
  fs.mkdirSync(folder);
  const list = {
    contacts: [
      { id: 'c1', name: 'Amos Beiler', email: 'amos@example.org', memberId: 'BEILA123', memberStatus: 'Active', orgId: 'o1', householdId: 'h1', fields: { phone: '555-0100' } },
      { id: 'c2', name: 'Sarah Beiler', email: '', memberId: '', orgId: 'o1', householdId: 'h1' },
      { id: 'c3', name: 'Signup Sam', email: 'sam@example.org', memberId: '', householdId: null },
    ],
    households: [{ id: 'h1', addressLine1: '102 Mill Rd', addressLine2: '', city: 'Gordonville', state: 'PA', zip: '17529', fields: { over65: true, joined: '1990-06-01' } }],
    orgs: [{ id: 'o1', name: 'Maple Grove Mennonite' }],
    publications: [{ id: 'p1', name: 'Our Health' }],
    fields: [
      { id: 'over65', label: 'Over 65', appliesTo: 'household', type: 'yesno' },
      { id: 'joined', label: 'Joined', appliesTo: 'household', type: 'date' },
      { id: 'phone', label: 'Phone', appliesTo: 'contact', type: 'text' },
      { id: 'district', label: 'District', appliesTo: 'org', type: 'choice' },
    ],
    retired: [
      { kind: 'contact', fromId: 'old1', toId: 'old2' },
      { kind: 'contact', fromId: 'old2', toId: 'c1' },
      { kind: 'contact', fromId: 'gone', toId: null },
      { kind: 'household', fromId: 'loopA', toId: 'loopB' },
      { kind: 'household', fromId: 'loopB', toId: 'loopA' },
    ],
    ...overrides,
  };
  for (const [name, rows] of Object.entries(list)) if (rows !== undefined) fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify(rows));
  return { dataDir, folder, list };
}

test('the list is found in the AB Apps folder of whoever is signed in, once MemberManager has one', (t) => {
  const { dataDir, folder } = setUp(t);
  assert.equal(members.memberListFolder({ dataDir }), folder);
  assert.equal(members.memberListFolder(null), null);
  assert.equal(members.memberListFolder({ dataDir: path.join(dataDir, 'elsewhere') }), null);
});

test('the whole list is read, with fields and retired empty until MemberManager writes them', (t) => {
  const { folder } = setUp(t, { fields: undefined, retired: undefined });
  const list = members.readMemberList(folder);
  assert.equal(list.contacts.length, 3);
  assert.deepEqual(list.fields, []);
  assert.deepEqual(list.retired, []);
});

test('a file mid-sync or missing reads as null, not as an empty list', (t) => {
  const { folder } = setUp(t);
  fs.writeFileSync(path.join(folder, 'households.json'), '[{"id": "h1", "addr');
  assert.equal(members.readMemberList(folder), null);
  fs.rmSync(path.join(folder, 'households.json'));
  assert.equal(members.readMemberList(folder), null);
  fs.writeFileSync(path.join(folder, 'households.json'), '[]');
  fs.writeFileSync(path.join(folder, 'retired.json'), 'not json');
  assert.equal(members.readMemberList(folder), null, 'a damaged optional file too');
});

test('members are the people with a Member ID, with their household and fields by name', (t) => {
  const { folder } = setUp(t);
  const [amos, ...others] = members.members(members.readMemberList(folder));
  assert.equal(others.length, 0);
  assert.deepEqual(amos, {
    id: 'c1',
    householdId: 'h1',
    memberId: 'BEILA123',
    memberStatus: 'Active',
    name: 'Amos Beiler',
    email: 'amos@example.org',
    addressLine1: '102 Mill Rd',
    addressLine2: '',
    city: 'Gordonville',
    state: 'PA',
    zip: '17529',
    orgName: 'Maple Grove Mennonite',
    fields: { 'Over 65': 'Yes', Joined: '6/1/1990', Phone: '555-0100' },
  });
});

test('a retired record is followed to where it went, through merges of merges', (t) => {
  const { folder } = setUp(t);
  const list = members.readMemberList(folder);
  assert.equal(members.currentId(list, 'contact', 'c1'), 'c1');
  assert.equal(members.currentId(list, 'contact', 'old1'), 'c1');
  assert.equal(members.currentId(list, 'contact', 'gone'), null);
  assert.equal(members.currentId(list, 'contact', 'never-heard-of'), null);
  assert.equal(members.currentId(list, 'household', 'loopA'), null, 'a loop ends rather than hangs');
});

test('a save is noticed', async (t) => {
  const { folder } = setUp(t);
  let changes = 0;
  const stop = members.watchMemberList(folder, () => changes++, { interval: 20 });
  t.after(stop);
  await new Promise((r) => setTimeout(r, 60));
  fs.writeFileSync(path.join(folder, 'contacts.json'), '[]');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(changes, 1);
});
