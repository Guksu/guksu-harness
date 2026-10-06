import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './load.mjs';

let api;
let all;

before(async () => {
  let tick = 0;
  api = await startServer({ clock: () => new Date(Date.UTC(2026, 0, 1, 9, 0, tick++)) });
  for (const customerId of ['c-1', 'c-2', 'c-1', 'c-2', 'c-1']) {
    const created = await api.request('POST', '/orders', { customerId, items: [{ sku: 'SOCKS-3P', quantity: 1 }] });
    assert.equal(created.status, 201);
  }
  all = (await api.request('GET', '/orders')).body.map((order) => order.id);
});

after(() => api.close());

const ids = (response) => response.body.map((order) => order.id);

test('파라미터가 없으면 전체 목록 배열과 전체 개수', async () => {
  const response = await api.request('GET', '/orders');
  assert.equal(response.status, 200);
  assert.deepEqual(all, ['ord_000005', 'ord_000004', 'ord_000003', 'ord_000002', 'ord_000001']);
  assert.equal(response.headers.get('x-total-count'), '5');
});

test('limit·offset 구간', async () => {
  const first = await api.request('GET', '/orders?limit=2');
  assert.deepEqual(ids(first), all.slice(0, 2));
  assert.equal(first.headers.get('x-total-count'), '5');
  assert.deepEqual(ids(await api.request('GET', '/orders?limit=2&offset=2')), all.slice(2, 4));
  assert.deepEqual(ids(await api.request('GET', '/orders?offset=4')), all.slice(4));
  const beyond = await api.request('GET', '/orders?offset=10');
  assert.deepEqual(beyond.body, []);
  assert.equal(beyond.headers.get('x-total-count'), '5');
});

test('customerId 필터 뒤에 페이지를 자른다', async () => {
  const response = await api.request('GET', '/orders?customerId=c-1&limit=1&offset=1');
  assert.deepEqual(ids(response), ['ord_000003']);
  assert.equal(response.headers.get('x-total-count'), '3');
});

test('잘못된 값은 400 invalid_request', async () => {
  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'offset=-1', 'offset=x', 'limit=-2']) {
    const response = await api.request('GET', `/orders?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.error, 'invalid_request', query);
  }
  assert.equal((await api.request('GET', '/orders?limit=100')).status, 200);
  assert.equal((await api.request('GET', '/orders?limit=1&offset=0')).status, 200);
});
