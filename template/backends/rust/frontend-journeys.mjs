import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

async function latestMail(mailpit, email, subject) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const listing = await fetch(`${mailpit}/api/v1/messages`).then((response) =>
      response.json()
    )
    const row = listing.messages.find(
      (message) =>
        message.Subject === subject &&
        message.To.some((to) => to.Address === email)
    )
    if (row) {
      const message = await fetch(`${mailpit}/api/v1/message/${row.ID}`).then(
        (response) => response.json()
      )
      const url = message.Text.match(/https?:\/\/[^\s<>]+/)?.[0]
      assert(url, "SMTP message must contain an action URL")
      return { url, message }
    }
    await delay(100)
  }
  throw new Error(
    "Expected SMTP message was not delivered to the owned Mailpit"
  )
}

export async function sdkJourney({
  createAuthClient,
  api,
  web,
  mailpit,
  publicUrl,
  message,
}) {
  const cookies = new Map()
  const client = createAuthClient({
    baseURL: api,
    fetchOptions: {
      customFetchImpl: async (input, init = {}) => {
        const headers = new Headers(init.headers)
        headers.set("origin", web)
        if (cookies.size)
          headers.set(
            "cookie",
            [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
          )
        const response = await fetch(input, {
          ...init,
          headers,
          redirect: "manual",
        })
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";", 1)[0]
          const separator = pair.indexOf("=")
          const name = pair.slice(0, separator)
          if (/max-age=0/i.test(cookie)) cookies.delete(name)
          else cookies.set(name, pair.slice(separator + 1))
        }
        return response
      },
    },
  })
  const email = `sdk-${randomUUID()}@example.test`
  const password = "SDK-Local-Password-2026!"
  const nextPassword = "SDK-New-Password-2026!"
  const signup = await client.signUp.email({
    email,
    name: "SDK Alice",
    password,
    callbackURL: publicUrl("/email-verified"),
  })
  assert.equal(signup.error, null)
  assert.equal(signup.data.token, null)
  assert.equal((await client.getSession()).data, null)
  const duplicate = await client.signUp.email({
    email: email.toUpperCase(),
    name: "Submitted duplicate name",
    password: "Different-SDK-Password-2026!",
    callbackURL: publicUrl("/email-verified"),
  })
  assert.equal(duplicate.error, null)
  assert.equal(duplicate.data.token, null)
  assert.equal(duplicate.data.user.name, "Submitted duplicate name")
  assert.equal(duplicate.data.user.email, email)
  assert.notEqual(duplicate.data.user.id, signup.data.user.id)
  assert.equal((await client.getSession()).data, null)
  const unverified = await client.signIn.email({ email, password })
  assert.equal(unverified.error.status, 403)
  assert.equal(unverified.error.code, "EMAIL_NOT_VERIFIED")
  const resend = await client.sendVerificationEmail({
    email,
    callbackURL: publicUrl("/email-verified"),
  })
  const unknown = await client.sendVerificationEmail({
    email: "unknown@example.test",
    callbackURL: publicUrl("/email-verified"),
  })
  assert.equal(resend.error, null)
  assert.deepEqual(resend.data, unknown.data)
  const verification = await latestMail(
    mailpit,
    email,
    message("email_verify_subject")
  )
  const verified = await fetch(verification.url, { redirect: "manual" })
  assert.equal(verified.status, 302)
  assert.equal(verified.headers.get("location"), publicUrl("/email-verified"))
  assert.equal((await client.getSession()).data, null)
  assert.equal((await client.signIn.email({ email, password })).error, null)
  const session = await client.getSession()
  assert.equal(session.error, null)
  assert.equal(session.data.user.email, email)
  assert.equal(session.data.user.emailVerified, true)
  const requested = await client.requestPasswordReset({
    email,
    redirectTo: publicUrl("/reset-password"),
  })
  const unknownReset = await client.requestPasswordReset({
    email: "unknown@example.test",
    redirectTo: publicUrl("/reset-password"),
  })
  assert.deepEqual(requested.data, unknownReset.data)
  const reset = await latestMail(mailpit, email, message("email_reset_subject"))
  const redirect = await fetch(reset.url, { redirect: "manual" })
  const target = new URL(redirect.headers.get("location"))
  assert.equal(target.pathname, new URL(publicUrl("/reset-password")).pathname)
  const token = target.searchParams.get("token")
  assert(token)
  assert.equal(
    (await client.resetPassword({ token, newPassword: nextPassword })).error,
    null
  )
  assert.equal((await client.getSession()).data, null)
  assert.equal(
    (await client.resetPassword({ token, newPassword: password })).error.status,
    400
  )
  assert.equal(
    (await client.signIn.email({ email, password })).error.status,
    401
  )
  assert.equal(
    (await client.signIn.email({ email, password: nextPassword })).error,
    null
  )
  assert.equal((await client.signOut()).error, null)
  assert.equal((await client.getSession()).data, null)
}

export async function browserJourney({
  expect,
  browser,
  api,
  mailpit,
  publicUrl,
  message,
  directory,
  locale,
}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  const email = `browser-${randomUUID()}@example.test`
  const password = "Browser-Local-Password-2026!"
  const nextPassword = "Browser-New-Password-2026!"
  const login = async (value) => {
    await page.getByLabel(message("email_label")).fill(email)
    await page
      .getByLabel(message("password_label"), { exact: true })
      .fill(value)
    await page
      .getByRole("button", { name: message("sign_in"), exact: true })
      .click()
  }
  try {
    await page.goto(publicUrl("/sign-up"))
    await expect(page.locator("html")).toHaveAttribute("lang", locale)
    await page.getByLabel(message("name_label"), { exact: true }).fill("Élodie")
    await page.getByLabel(message("email_label")).fill(email)
    await page
      .getByLabel(message("password_label"), { exact: true })
      .fill(password)
    await page
      .getByRole("button", { name: message("sign_up"), exact: true })
      .click()
    await expect(page).toHaveURL(publicUrl("/verify-email"))
    await page.goto(publicUrl("/sign-in"))
    await login(password)
    await expect(page.locator("main")).toContainText(
      message("email_not_verified")
    )
    await page.goto(publicUrl("/"))
    await expect(page).toHaveURL(
      (url) => url.pathname === new URL(publicUrl("/sign-in")).pathname
    )
    const verification = await latestMail(
      mailpit,
      email,
      message("email_verify_subject")
    )
    assert(verification.message.HTML.includes(`lang="${locale}"`))
    await page.goto(verification.url)
    await expect(
      page.getByRole("heading", { name: message("verification_complete") })
    ).toBeVisible()
    await page.getByRole("link", { name: message("back_sign_in") }).click()
    await login(password)
    await expect(
      page.getByRole("heading", {
        name: message("welcome", { name: "Élodie" }),
      })
    ).toBeVisible()
    await expect(page.getByRole("table")).toContainText(email)
    await page
      .getByRole("button", { name: message("sign_out"), exact: true })
      .click()
    await expect(page).toHaveURL(
      (url) => url.pathname === new URL(publicUrl("/sign-in")).pathname
    )
    await page.getByRole("link", { name: message("forgot_password") }).click()
    await expect(page).toHaveURL(publicUrl("/forgot-password"))
    await expect(
      page.getByRole("heading", { name: message("forgot_title") })
    ).toBeVisible()
    await page.getByLabel(message("email_label")).fill(email)
    await page
      .getByRole("button", { name: message("send_reset"), exact: true })
      .click()
    await expect(page.locator("main")).toContainText(
      message("email_request_received")
    )
    const reset = await latestMail(
      mailpit,
      email,
      message("email_reset_subject")
    )
    await page.goto(reset.url)
    await page
      .getByLabel(message("new_password_label"), { exact: true })
      .fill(nextPassword)
    await page.getByLabel(message("confirm_password_label")).fill(nextPassword)
    await page
      .getByRole("button", { name: message("reset_submit"), exact: true })
      .click()
    await expect(page).toHaveURL(
      (url) => url.pathname === new URL(publicUrl("/sign-in")).pathname
    )
    await login(password)
    await expect(page.locator("main")).toContainText(
      message("invalid_credentials")
    )
    await login(nextPassword)
    await expect(
      page.getByRole("heading", {
        name: message("welcome", { name: "Élodie" }),
      })
    ).toBeVisible()
    assert.equal((await page.request.get(`${api}/api/me`)).status(), 200)
    assert.deepEqual(errors, [])
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    await page.screenshot({
      path: join(directory, `${locale}-completed.png`),
      fullPage: true,
    })
    await page
      .getByRole("button", { name: message("sign_out"), exact: true })
      .click()
    await expect(page).toHaveURL(
      (url) => url.pathname === new URL(publicUrl("/sign-in")).pathname
    )
    await page.goto(publicUrl("/"))
    await expect(page).toHaveURL(
      (url) => url.pathname === new URL(publicUrl("/sign-in")).pathname
    )
  } catch (error) {
    await page.screenshot({
      path: join(directory, `${locale}-failure.png`),
      fullPage: true,
    })
    throw error
  } finally {
    await context.close()
  }
}
