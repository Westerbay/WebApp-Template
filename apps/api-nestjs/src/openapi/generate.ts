import { writeFile } from "node:fs/promises"

import { createApiApp } from "../app.js"
import { createOpenApiDocument } from "./document.js"

const outputPath = process.argv[2]

if (!outputPath) {
  throw new Error("Usage: generate-openapi <output-path>")
}

const app = await createApiApp({
  authHandler: (_request, response) => response.sendStatus(404),
  getSession: () => Promise.resolve(null),
  listUsers: () => Promise.resolve({ items: [], nextCursor: null }),
  databaseReady: () => Promise.resolve(),
})

try {
  await app.init()
  const document = createOpenApiDocument(app)
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`)
} finally {
  await app.close()
}
