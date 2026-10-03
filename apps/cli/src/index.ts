#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { resolve } from "node:path"

import { createToolRegistry, runAgentLoop, type ToolDefinition } from "@landache/agent"
import type { AgentEvent } from "@landache/protocol"
import { createProviderModelStream, resolveProviderConfig } from "@landache/providers"
import { RuntimeClient } from "@landache/runtime-client"

import { approveReadOperation } from "./read-file-policy.js"

const prompt = process.argv.slice(2).join(" ").trim()
if (prompt === "") {
  console.error("usage: landache <prompt>")
  process.exitCode = 2
} else {
  await main(prompt)
}

async function main(prompt: string): Promise<void> {
  const controller = new AbortController()
  process.once("SIGINT", () => controller.abort(new Error("Cancelled by user")))

  try {
    const provider = resolveProviderConfig(process.env)
    const runtime = new RuntimeClient({
      workspaceRoot: process.cwd(),
      executable: process.env.LANDACHE_RUNTIME_BIN ?? resolve("target/debug/landache-runtime"),
    })
    const readFile: ToolDefinition = {
      name: "read_file",
      description: "Read one UTF-8 file using a path relative to the current workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      validate: (input) =>
        typeof input.path === "string" && input.path.length > 0
          ? { ok: true, value: input }
          : { ok: false, error: "path must be a non-empty string" },
      execute: async (input, signal) => {
        const path = String(input.path)
        await approveReadOperation("read_file", path)
        return { content: await runtime.readFile(path, signal) }
      },
    }
    const listDirectory: ToolDefinition = {
      name: "list_directory",
      description: "List one directory using a path relative to the current workspace. This does not recurse.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      validate: (input) =>
        typeof input.path === "string" && input.path.length > 0
          ? { ok: true, value: input }
          : { ok: false, error: "path must be a non-empty string" },
      execute: async (input, signal) => {
        const path = String(input.path)
        await approveReadOperation("list_directory", path)
        return { entries: await runtime.listDirectory(path, signal) }
      },
    }
    const searchText: ToolDefinition = {
      name: "search_text",
      description: "Recursively find literal text in UTF-8 files below a workspace-relative directory.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          query: { type: "string" },
        },
        required: ["path", "query"],
        additionalProperties: false,
      },
      validate: (input) =>
        typeof input.path === "string" && input.path.length > 0
          && typeof input.query === "string" && input.query.length > 0
          ? { ok: true, value: input }
          : { ok: false, error: "path and query must be non-empty strings" },
      execute: async (input, signal) => {
        const path = String(input.path)
        const query = String(input.query)
        await approveReadOperation("search_text", path)
        return await runtime.searchText(path, query, signal)
      },
    }

    const result = await runAgentLoop({
      messages: [{ id: randomUUID(), role: "user", content: prompt }],
      registry: createToolRegistry([readFile, listDirectory, searchText]),
      streamModel: createProviderModelStream(provider),
      maxTurns: 8,
      createMessageId: randomUUID,
      signal: controller.signal,
      emit: printEvent,
    })
    if (!result.assistantMessage.content.some((content) => content.type === "text")) {
      console.error(`Model stopped with ${result.assistantMessage.stopReason}`)
    } else {
      process.stdout.write("\n")
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = controller.signal.aborted ? 130 : 1
  }
}

function printEvent(event: AgentEvent): void {
  if (event.type === "message.delta") {
    process.stdout.write(event.delta)
  } else if (event.type === "tool.call.started") {
    console.error(`\n[tool] ${event.toolCall.name}`)
  } else if (event.type === "tool.call.completed" && event.result.content.type === "error") {
    console.error(`[tool error] ${event.result.content.message}`)
  }
}
