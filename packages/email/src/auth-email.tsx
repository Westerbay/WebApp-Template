import { authTokenConstraints } from "@workspace/contracts/auth/constraints"
import { renderToStaticMarkup } from "react-dom/server"
import { toPlainText } from "@react-email/render"
import {
  email_verify_subject,
  email_verify_body,
  email_verify_action,
  email_reset_subject,
  email_reset_body,
  email_reset_action,
  email_expiry,
  email_fallback,
} from "@workspace/i18n/messages"
import type { Locale } from "@workspace/i18n/runtime"
import type { EmailMessage } from "@workspace/core/email"

export interface AuthEmailInput {
  kind: "verification" | "reset"
  to: string
  url: string
  locale: Locale
}

export async function renderAuthEmail(
  input: AuthEmailInput
): Promise<EmailMessage> {
  const locale = { locale: input.locale }
  let subject = email_verify_subject({}, locale)
  let body = email_verify_body({}, locale)
  let action = email_verify_action({}, locale)
  let hours = authTokenConstraints.emailVerificationExpiresInHours
  if (input.kind === "reset") {
    subject = email_reset_subject({}, locale)
    body = email_reset_body({}, locale)
    action = email_reset_action({}, locale)
    hours = authTokenConstraints.resetPasswordExpiresInHours
  }
  const html =
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang={input.locale}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{subject}</title>
        </head>
        <body
          style={{
            fontFamily: "Arial, sans-serif",
            backgroundColor: "#f6f6f6",
            color: "#18181b",
          }}
        >
          <table
            role="presentation"
            style={{
              backgroundColor: "#ffffff",
              padding: "32px",
              margin: "32px auto",
              maxWidth: "480px",
              width: "100%",
              borderSpacing: 0,
            }}
          >
            <tbody>
              <tr>
                <td>
                  <h1>{subject}</h1>
                  <p>{body}</p>
                  <a
                    href={input.url}
                    style={{
                      display: "inline-block",
                      textDecoration: "none",
                      backgroundColor: "#18181b",
                      color: "#ffffff",
                      padding: "14px 20px",
                      borderRadius: "6px",
                    }}
                  >
                    {action}
                  </a>
                  <p>{email_expiry({ hours }, locale)}</p>
                  <p>{email_fallback({}, locale)}</p>
                  <p style={{ wordBreak: "break-all" }}>{input.url}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    )
  return { to: input.to, subject, html, text: toPlainText(html) }
}
