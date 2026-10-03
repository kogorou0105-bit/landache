import assert from "node:assert/strict"
import test from "node:test"

import { RuntimeCallError, RuntimeClient, parseRuntimeResponse } from "@landache/runtime-client"

test("parses successful and failed runtime responses", () => {
  assert.deepEqual(parseRuntimeResponse('{"version":1,"id":"r1","result":{"content":"hello"}}'), {
    version: 1,
    id: "r1",
    result: { content: "hello" },
  })
  assert.deepEqual(parseRuntimeResponse('{"version":1,"id":"r2","error":{"code":"not_found","message":"missing"}}'), {
    version: 1,
    id: "r2",
    error: { code: "not_found", message: "missing" },
  })
  assert.deepEqual(parseRuntimeResponse(
    '{"version":1,"id":"r3","result":{"entries":[{"path":"src","type":"directory"}]}}',
  ), {
    version: 1,
    id: "r3",
    result: { entries: [{ path: "src", type: "directory" }] },
  })
  assert.deepEqual(parseRuntimeResponse(
    '{"version":1,"id":"r4","result":{"matches":[{"path":"src/a.ts","line":2,"column":3,"preview":"  hit"}],"truncated":false}}',
  ), {
    version: 1,
    id: "r4",
    result: {
      matches: [{ path: "src/a.ts", line: 2, column: 3, preview: "  hit" }],
      truncated: false,
    },
  })
})

test("invokes directory listing and text search methods", async () => {
  const runtime = new RuntimeClient({
    workspaceRoot: process.cwd(),
    executable: process.execPath,
    executableArgs: [
      "-e",
      "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { const r=JSON.parse(data); const result=r.method==='list_directory' ? {entries:[{path:r.params.path,type:'directory'}]} : {matches:[{path:r.params.path,line:1,column:1,preview:r.params.query}],truncated:false}; console.log(JSON.stringify({version:1,id:r.id,result})); });",
      "--",
    ],
    createRequestId: () => "request-1",
  })

  assert.deepEqual(await runtime.listDirectory("src"), [{ path: "src", type: "directory" }])
  assert.deepEqual(await runtime.searchText("src", "needle"), {
    matches: [{ path: "src", line: 1, column: 1, preview: "needle" }],
    truncated: false,
  })
})

test("rejects malformed runtime responses", () => {
  assert.throws(() => parseRuntimeResponse('{"version":2,"id":"r1","result":{"content":"x"}}'), /envelope/)
  assert.throws(() => parseRuntimeResponse('{"version":1,"id":"","result":{"content":"x"}}'), /envelope/)
  assert.throws(() => parseRuntimeResponse('{"version":1,"id":"r1","result":{"content":"x"},"error":{}}'), /payload/)
  assert.throws(() => parseRuntimeResponse('{"version":1,"id":"r1","result":{"content":"x","extra":true}}'), /payload/)
})

test("invokes a runtime process and correlates the response", async () => {
  const runtime = new RuntimeClient({
    workspaceRoot: process.cwd(),
    executable: process.execPath,
    executableArgs: [
      "-e",
      "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { const request=JSON.parse(data); console.log(JSON.stringify({version:1,id:request.id,result:{content:request.params.path}})); });",
      "--",
    ],
    createRequestId: () => "request-1",
  })

  assert.equal(await runtime.readFile("README.md"), "README.md")
})

test("turns a runtime error response into RuntimeCallError", async () => {
  const runtime = new RuntimeClient({
    workspaceRoot: process.cwd(),
    executable: process.execPath,
    executableArgs: [
      "-e",
      "let data=''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => { const request=JSON.parse(data); console.log(JSON.stringify({version:1,id:request.id,error:{code:'not_found',message:'missing'}})); });",
      "--",
    ],
    createRequestId: () => "request-1",
  })

  await assert.rejects(
    runtime.readFile("missing.txt"),
    (error: unknown) => error instanceof RuntimeCallError && error.code === "not_found",
  )
})

test("rejects a response with a different request id", async () => {
  const runtime = new RuntimeClient({
    workspaceRoot: process.cwd(),
    executable: process.execPath,
    executableArgs: [
      "-e",
      "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({version:1,id:'wrong-id',result:{content:'x'}})));",
      "--",
    ],
    createRequestId: () => "request-1",
  })

  await assert.rejects(runtime.readFile("README.md"), /response id mismatch/)
})

test("aborts an executing runtime call", async () => {
  const runtime = new RuntimeClient({
    workspaceRoot: process.cwd(),
    executable: process.execPath,
    executableArgs: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);", "--"],
    createRequestId: () => "request-1",
  })
  const controller = new AbortController()
  const call = runtime.readFile("README.md", controller.signal)
  controller.abort(new Error("test abort"))

  await assert.rejects(call, /test abort/)
})
