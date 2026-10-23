import { schema } from "@workspace/database"
import { authPasswordConstraints } from "@workspace/contracts/auth/constraints"
import projectConfig from "@workspace/config/project" with { type: "json" }
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { haveIBeenPwned } from "better-auth/plugins"
import { getAuthEmailLocale } from "./email-locale.js"

import { createRateLimitStore } from "./rate-limit-store.js"
import { authConfig } from "./auth.config.js"
import type { Database } from "@workspace/database"
import type { ApiEnv } from "../../config/env.js"

import type { AuthEmailDispatcher } from "../email/auth-email-dispatcher.js"

export function createAuth(
  db: Database,
  env: ApiEnv,
  emails: AuthEmailDispatcher,
  reportProviderLog: (level: string) => void = () => undefined
) {
  return betterAuth({
    appName: projectConfig.name,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_URL],
    plugins: [
      haveIBeenPwned({
        enabled: ["staging", "production"].includes(env.APP_ENV),
      }),
    ],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    logger: {
      log: (level) => {
        reportProviderLog(level)
      },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: ["staging", "production"].includes(env.APP_ENV),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: ["x-auth-client-ip"] },
    },
    session: {
      expiresIn: authConfig.session.expiresInSeconds,
      updateAge: authConfig.session.updateAgeSeconds,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customStorage: createRateLimitStore(
        db,
        authConfig.rateLimit.windowSeconds
      ),
      window: authConfig.rateLimit.windowSeconds,
      max: authConfig.rateLimit.defaultMaxRequests,
      customRules: {
        "/sign-in/email": {
          window: authConfig.rateLimit.windowSeconds,
          max: authConfig.rateLimit.sensitiveMaxRequests,
        },
        "/sign-up/email": {
          window: authConfig.rateLimit.windowSeconds,
          max: authConfig.rateLimit.sensitiveMaxRequests,
        },
        "/send-verification-email": {
          window: authConfig.rateLimit.windowSeconds,
          max: authConfig.rateLimit.sensitiveMaxRequests,
        },
        "/request-password-reset": {
          window: authConfig.rateLimit.windowSeconds,
          max: authConfig.rateLimit.sensitiveMaxRequests,
        },
        "/reset-password": {
          window: authConfig.rateLimit.windowSeconds,
          max: authConfig.rateLimit.sensitiveMaxRequests,
        },
      },
    },
    emailVerification: {
      expiresIn: authConfig.emailVerificationExpiresInSeconds,
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, url }, request) => {
        emails.enqueue({
          kind: "verification",
          to: user.email,
          url,
          locale: getAuthEmailLocale(url, env.WEB_URL),
          requestId: request?.headers.get("x-request-id") ?? undefined,
        })
        return Promise.resolve()
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: authPasswordConstraints.minLength,
      maxPasswordLength: authPasswordConstraints.maxLength,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn:
        authConfig.resetPasswordTokenExpiresInSeconds,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }, request) => {
        emails.enqueue({
          kind: "reset",
          to: user.email,
          url,
          locale: getAuthEmailLocale(url, env.WEB_URL),
          requestId: request?.headers.get("x-request-id") ?? undefined,
        })
        return Promise.resolve()
      },
    },
  })
}
