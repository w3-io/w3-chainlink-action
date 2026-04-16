/**
 * Data Streams unit tests. Mocks global.fetch so we can assert on the
 * URL, method, and auth headers without making a real network call.
 * The HMAC is deterministic given a fixed timestamp — we inject it
 * via a clock override where possible, or just verify shape.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { streamsListFeeds, streamsFetchReport, ChainlinkError } from '../src/chainlink.js'

let originalFetch
let calls

beforeEach(() => {
  originalFetch = global.fetch
  calls = []
})

afterEach(() => {
  global.fetch = originalFetch
})

function mockFetch(responses) {
  let i = 0
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    const r = responses[i++]
    if (!r) throw new Error(`Unexpected fetch ${i}: ${url}`)
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
    }
  }
}

describe('Data Streams: auth', () => {
  it('requires client-id', async () => {
    await assert.rejects(
      () => streamsListFeeds({ clientSecret: 'secret' }),
      (e) => e instanceof ChainlinkError && e.code === 'MISSING_STREAMS_CLIENT_ID',
    )
  })

  it('requires client-secret', async () => {
    await assert.rejects(
      () => streamsListFeeds({ clientId: 'id' }),
      (e) => e instanceof ChainlinkError && e.code === 'MISSING_STREAMS_CLIENT_SECRET',
    )
  })

  it('sends Authorization, X-Authorization-Timestamp, and X-Authorization-Signature-SHA256', async () => {
    mockFetch([{ body: { feeds: [] } }])
    await streamsListFeeds({ clientId: 'test-id', clientSecret: 'test-secret' })
    const h = calls[0].options.headers
    assert.equal(h.Authorization, 'test-id')
    assert.match(h['X-Authorization-Timestamp'], /^\d{13}$/)
    assert.match(h['X-Authorization-Signature-SHA256'], /^[0-9a-f]{64}$/)
  })

  it('signs the request with HMAC-SHA256 over METHOD PATH BODYHASH CLIENT TIMESTAMP', async () => {
    // Capture the timestamp the library chose, then recompute the expected
    // signature the same way the SDK does and compare.
    mockFetch([{ body: { feeds: [] } }])
    await streamsListFeeds({
      clientId: 'id-abc',
      clientSecret: 'hunter2',
      apiUrl: 'https://api.example.com',
    })
    const h = calls[0].options.headers
    const ts = h['X-Authorization-Timestamp']
    const bodyHash = createHash('sha256').update('').digest('hex')
    const expected = createHmac('sha256', 'hunter2')
      .update(`GET /api/v1/feeds ${bodyHash} id-abc ${ts}`)
      .digest('hex')
    assert.equal(h['X-Authorization-Signature-SHA256'], expected)
  })
})

describe('Data Streams: endpoints', () => {
  it('listFeeds hits /api/v1/feeds', async () => {
    mockFetch([{ body: { feeds: [{ feedID: '0xabc' }] } }])
    const result = await streamsListFeeds({
      clientId: 'id',
      clientSecret: 'secret',
      apiUrl: 'https://api.example.com',
    })
    assert.equal(calls[0].url, 'https://api.example.com/api/v1/feeds')
    assert.equal(calls[0].options.method, 'GET')
    assert.deepEqual(result, { feeds: [{ feedID: '0xabc' }] })
  })

  it('fetchReport (latest) hits /api/v1/reports/latest?feedID=', async () => {
    mockFetch([{ body: { report: { feedID: '0xabc', price: '100' } } }])
    await streamsFetchReport('0xabc', {
      clientId: 'id',
      clientSecret: 'secret',
      apiUrl: 'https://api.example.com',
    })
    assert.equal(calls[0].url, 'https://api.example.com/api/v1/reports/latest?feedID=0xabc')
  })

  it('fetchReport (with timestamp) hits /api/v1/reports?feedID=&timestamp=', async () => {
    mockFetch([{ body: { report: { feedID: '0xabc' } } }])
    await streamsFetchReport('0xabc', {
      clientId: 'id',
      clientSecret: 'secret',
      timestamp: 1776350951,
      apiUrl: 'https://api.example.com',
    })
    assert.equal(
      calls[0].url,
      'https://api.example.com/api/v1/reports?feedID=0xabc&timestamp=1776350951',
    )
  })

  it('URL-encodes the feed ID', async () => {
    mockFetch([{ body: { report: {} } }])
    await streamsFetchReport('0x00ff:weird', {
      clientId: 'id',
      clientSecret: 'secret',
      apiUrl: 'https://api.example.com',
    })
    assert.match(calls[0].url, /feedID=0x00ff%3Aweird/)
  })
})

describe('Data Streams: error handling', () => {
  it('throws ChainlinkError with STREAMS_API_ERROR on non-2xx', async () => {
    mockFetch([{ status: 401, body: { error: 'Unauthorized' } }])
    await assert.rejects(
      () =>
        streamsListFeeds({
          clientId: 'id',
          clientSecret: 'secret',
          apiUrl: 'https://api.example.com',
        }),
      (e) => e instanceof ChainlinkError && e.code === 'STREAMS_API_ERROR' && /401/.test(e.message),
    )
  })

  it('requires feed-id on fetchReport', async () => {
    await assert.rejects(
      () => streamsFetchReport('', { clientId: 'id', clientSecret: 'secret' }),
      (e) => e instanceof ChainlinkError && e.code === 'MISSING_FEED_ID',
    )
  })

  it('throws STREAMS_PARSE_ERROR on invalid JSON', async () => {
    mockFetch([{ body: 'not json at all' }])
    await assert.rejects(
      () =>
        streamsListFeeds({
          clientId: 'id',
          clientSecret: 'secret',
          apiUrl: 'https://api.example.com',
        }),
      (e) => e instanceof ChainlinkError && e.code === 'STREAMS_PARSE_ERROR',
    )
  })
})
