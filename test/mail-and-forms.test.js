'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransport } = require('../src/mailer');
const { listForms, fetchEntries, gfFetch } = require('../src/gravityforms');

test('a relay with no user name is used without signing in, even with an old password saved', () => {
  const relay = createTransport({ host: 'relay.example.org', port: 25, secure: false, user: '', password: 'old' });
  assert.equal(relay.options.auth, undefined);
  assert.equal(relay.options.port, 25);
  const account = createTransport({ host: 'smtp.example.org', port: '587', user: 'me@example.org', password: 'pw' });
  assert.deepEqual(account.options.auth, { user: 'me@example.org', pass: 'pw' });
  assert.equal(account.options.port, 587);
});

/** A stand-in for fetch that answers each request from `answer(url)`, and keeps the requests. */
function fakeFetch(answer) {
  const fetch = async (url, init) => {
    fetch.requests.push({ url, init });
    const { status = 200, body } = answer(url);
    return new Response(JSON.stringify(body), { status });
  };
  fetch.requests = [];
  return fetch;
}

const connection = { siteUrl: 'https://example.org/', consumerKey: 'ck', consumerSecret: 'cs', formId: '5' };

test('forms are listed with the key as Basic Auth, in either shape the API answers', async () => {
  const fetch = fakeFetch(() => ({ body: { 1: { id: 1, title: 'Signup' }, 2: { id: 2 } } }));
  assert.deepEqual(await listForms(connection, { fetch }), [{ id: '1', title: 'Signup' }, { id: '2', title: 'Form 2' }]);
  assert.equal(fetch.requests[0].url, 'https://example.org/wp-json/gf/v2/forms');
  assert.equal(fetch.requests[0].init.headers.Authorization, `Basic ${Buffer.from('ck:cs').toString('base64')}`);
});

test('entries are read newest first, down to the last one already seen', async () => {
  const fetch = fakeFetch(() => ({ body: { total_count: 4, entries: [{ id: '9' }, { id: '8' }, { id: '7' }, { id: '6' }] } }));
  assert.deepEqual((await fetchEntries(connection, 7, { fetch })).map((e) => e.id), ['9', '8']);
  assert.match(fetch.requests[0].url, /forms\/5\/entries\?.*sorting\[direction\]=DESC/);
});

test('only https is used, and problems are explained', async () => {
  await assert.rejects(gfFetch({ ...connection, siteUrl: 'http://example.org' }, 'forms', { fetch: fakeFetch(() => ({})) }), /https/);
  await assert.rejects(gfFetch(connection, 'forms', { fetch: fakeFetch(() => ({ status: 401 })) }), /answered 401 for forms/);
  await assert.rejects(gfFetch(connection, 'forms', { fetch: async () => { throw new TypeError('fetch failed'); } }), /couldn't be reached/);
});
