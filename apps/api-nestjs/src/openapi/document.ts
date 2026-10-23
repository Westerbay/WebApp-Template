import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import projectConfig from "@workspace/config/project" with { type: "json" }
import { cleanupOpenApiDoc } from "nestjs-zod"

import { openApiConfig } from "./config.js"
import type { INestApplication } from "@nestjs/common"

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle(`${projectConfig.name} API`)
    .setDescription(projectConfig.description)
    .setVersion(openApiConfig.version)
    .addCookieAuth("better-auth.session_token")
    .build()

  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config), {
    version: "3.1",
  })
}

export function setupOpenApi(app: INestApplication) {
  SwaggerModule.setup(openApiConfig.docsPath, app, createOpenApiDocument(app))
}
