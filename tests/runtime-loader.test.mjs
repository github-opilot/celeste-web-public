import assert from 'node:assert/strict'
import test from 'node:test'

const { splitWasmLoader } = await import('../dist/celeste/celeste.runtime.js')

function wasmResource(fetchImpl, expectedParts) {
  return splitWasmLoader(fetchImpl, expectedParts)(
    'dotnetwasm',
    'dotnet.native.wasm',
    'https://runtime.example/celeste/_framework/dotnet.native.hash.wasm',
    '',
    'dotnetwasm',
  )
}

test('the runtime loader fetches exactly the declared WASM pieces', async () => {
  const urls = []
  const resource = wasmResource(async (url) => {
    urls.push(url)
    return new Response(Uint8Array.of(urls.length), {
      headers: { 'content-type': 'application/wasm' },
    })
  }, 2)

  const response = await resource
  assert.equal(response.headers.get('content-type'), 'application/wasm')
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2])
  assert.deepEqual(urls, [
    'https://runtime.example/celeste/_framework/dotnet.native.hash.wasm0',
    'https://runtime.example/celeste/_framework/dotnet.native.hash.wasm1',
  ])
})

test('a missing declared WASM piece fails with its index and HTTP status', async () => {
  let calls = 0
  const resource = wasmResource(async () => {
    calls += 1
    return calls === 1
      ? new Response(Uint8Array.of(1), { headers: { 'content-type': 'application/wasm' } })
      : new Response('not found', { status: 404 })
  }, 2)

  const response = await resource
  await assert.rejects(response.arrayBuffer(), /WebAssembly part 2 of 2 .*HTTP 404/)
})

test('a network failure names the WASM piece being requested', async () => {
  await assert.rejects(
    wasmResource(async () => {
      throw new TypeError('fetch failed')
    }, 3),
    /network error downloading WebAssembly part 1 of 3/,
  )
})

test('older runtime descriptors still use 404 to finish a split WASM stream', async () => {
  let calls = 0
  const resource = wasmResource(async () => {
    calls += 1
    return calls === 1
      ? new Response(Uint8Array.of(7), { headers: { 'content-type': 'application/wasm' } })
      : new Response('not found', { status: 404 })
  })

  const response = await resource
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7])
  assert.equal(calls, 2)
})
