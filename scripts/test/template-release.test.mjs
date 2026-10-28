import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { publishRelease } from "../template-release.mjs"

function fixture(t, releases = []) {
  const directory = mkdtempSync(join(tmpdir(), "template-release-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const files = ["webapp-template-en.zip", "webapp-template-fr.zip"].map(
    (name) => {
      const path = join(directory, name)
      writeFileSync(path, name)
      return path
    }
  )
  const calls = []
  const assets = []
  let failUpload = false
  const release = { id: 42, tag_name: "v1.0.0", draft: true }
  function api(args) {
    calls.push(args)
    const [endpoint] = args
    if (endpoint === "repos/owner/repo/releases?per_page=100") {
      return [[], releases] // Exercise matches beyond the first page.
    }
    if (endpoint === "repos/owner/repo/git/ref/tags/v1.0.0") return {}
    if (endpoint === "repos/owner/repo/releases") {
      assert.ok(args.includes("draft=true"))
      assert.ok(args.includes("generate_release_notes=true"))
      releases.push(release)
      return release
    }
    if (endpoint === "repos/owner/repo/releases/42/assets?per_page=100") {
      return [assets]
    }
    if (
      endpoint.startsWith(
        "https://uploads.github.com/repos/owner/repo/releases/42/assets?"
      )
    ) {
      if (failUpload) throw new Error("Upload failed")
      const name = new URL(endpoint).searchParams.get("name")
      assert.equal(args[args.indexOf("--input") + 1], join(directory, name))
      const asset = {
        name,
        state: "uploaded",
        digest: `sha256:${createHash("sha256").update(name).digest("hex")}`,
      }
      assets.push(asset)
      return asset
    }
    if (endpoint === "repos/owner/repo/releases/42") {
      assert.deepEqual(args.slice(1), [
        "--method",
        "PATCH",
        "-F",
        "draft=false",
      ])
      release.draft = false
      return release
    }
    throw new Error(`Unexpected API call: ${args.join(" ")}`)
  }
  return {
    calls,
    assets,
    failUpload: () => {
      failUpload = true
    },
    publish: (client = api) =>
      publishRelease("owner/repo", "v1.0.0", files, client),
  }
}

test("creates one draft and uploads/publishes using its returned ID", (t) => {
  const f = fixture(t)
  f.publish()
  assert.equal(f.assets.length, 2)
  assert.equal(
    f.calls.filter(([url]) => url === "repos/owner/repo/releases").length,
    1
  )
  assert.equal(f.calls.at(-1)[0], "repos/owner/repo/releases/42")
})

test("reuses a published release even when a stale draft has the same tag", (t) => {
  const f = fixture(t, [
    { id: 99, tag_name: "v1.0.0", draft: true },
    { id: 42, tag_name: "v1.0.0", draft: false },
  ])
  f.publish()
  f.publish()
  assert.equal(f.assets.length, 2, "Retry must not upload duplicate assets")
  assert.ok(!f.calls.some((args) => args.includes("PATCH")))
  assert.ok(!f.calls.some(([url]) => url === "repos/owner/repo/releases"))
})

test("resumes a partial draft without replacing matching assets", (t) => {
  const f = fixture(t, [{ id: 42, tag_name: "v1.0.0", draft: true }])
  f.assets.push({
    name: "webapp-template-en.zip",
    state: "uploaded",
    digest: `sha256:${createHash("sha256").update("webapp-template-en.zip").digest("hex")}`,
  })
  f.publish()
  assert.equal(f.assets.length, 2)
  assert.equal(f.calls.at(-1)[0], "repos/owner/repo/releases/42")
})

test("fails on ambiguous drafts instead of creating or publishing another", (t) => {
  const f = fixture(
    t,
    [42, 99].map((id) => ({ id, tag_name: "v1.0.0", draft: true }))
  )
  assert.throws(() => f.publish(), /Multiple releases/)
  assert.equal(f.calls.length, 1)
})

test("API lookup failure does not create a release", (t) => {
  const f = fixture(t)
  assert.throws(
    () =>
      f.publish(() => {
        throw new Error("Forbidden")
      }),
    /Forbidden/
  )
})

test("upload failure leaves the draft unpublished", (t) => {
  const f = fixture(t)
  f.failUpload()
  assert.throws(() => f.publish(), /Upload failed/)
  assert.ok(!f.calls.some((args) => args.includes("PATCH")))
})

test("conflicting assets fail before uploading or replacing any file", (t) => {
  const f = fixture(t, [{ id: 42, tag_name: "v1.0.0", draft: false }])
  f.assets.push({
    name: "webapp-template-fr.zip",
    state: "uploaded",
    digest: "sha256:other",
  })
  assert.throws(() => f.publish(), /different or incomplete/)
  assert.equal(f.calls.length, 2)
})
