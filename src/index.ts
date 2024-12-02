#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js"; // Add .js extension
import { Id } from "../convex/_generated/dataModel.js"; // Import Id type
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: path.resolve(__dirname, "../.env") });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
}

const client = new ConvexClient(convexUrl);

const server = new Server(
  {
    name: "convex-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// List all notes as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const notes = await client.query(api.notes.list, {}); // Add empty args object

  return {
    resources: notes.map(
      (note: { _id: Id<"notes">; title: string; content: string }) => ({
        uri: `note:///${note._id}`,
        mimeType: "text/plain",
        name: note.title,
        description: `A text note: ${note.title}`,
      }),
    ),
  };
});

// Read a specific note
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const noteId = url.pathname.replace(/^\//, "");

  try {
    const note = await client.query(api.notes.get, {
      id: noteId as Id<"notes">,
    });

    if (!note) {
      throw new McpError(ErrorCode.InvalidRequest, `Note ${noteId} not found`);
    }

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: note.content,
        },
      ],
    };
  } catch (error) {
    throw new McpError(ErrorCode.InvalidRequest, `Invalid note ID: ${noteId}`);
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_note",
        description: "Create a new note",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the note",
            },
            content: {
              type: "string",
              description: "Text content of the note",
            },
          },
          required: ["title", "content"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "create_note": {
      const title = String(request.params.arguments?.title);
      const content = String(request.params.arguments?.content);

      if (!title || !content) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Title and content are required",
        );
      }

      const id = await client.mutation(api.notes.create, { title, content });

      return {
        content: [
          {
            type: "text",
            text: `Created note ${id}: ${title}`,
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Convex MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
