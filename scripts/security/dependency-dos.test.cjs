const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { test } = require("node:test")
const { once } = require("node:events")

const expected = { minimatch: ["10.2.6", "11.0.4"] }
// Follow reachable dependency links; obsolete virtual-store entries are not installed dependencies.
function installedPackages() {
  const pending = [path.resolve("node_modules")]
  for (const root of ["apps", "packages", "infra"]) {
    if (fs.existsSync(root))
      for (const entry of fs.readdirSync(root))
        pending.push(path.resolve(root, entry, "node_modules"))
  }
  const seen = new Set()
  const found = new Map()
  while (pending.length) {
    const directory = pending.pop()
    if (!fs.existsSync(directory)) continue
    const real = fs.realpathSync(directory)
    if (seen.has(real)) continue
    seen.add(real)
    for (const entry of fs.readdirSync(directory)) {
      const location = path.join(directory, entry)
      if (entry.startsWith("@")) {
        pending.push(location)
      } else if (!entry.startsWith(".")) {
        pending.push(path.join(location, "node_modules"))
        if (fs.existsSync(location)) {
          let parent = path.dirname(fs.realpathSync(location))
          if (path.basename(parent).startsWith("@"))
            parent = path.dirname(parent)
          if (path.basename(parent) === "node_modules") pending.push(parent)
        }
        if (
          Object.hasOwn(expected, entry) &&
          fs.existsSync(path.join(location, "package.json"))
        ) {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(location, "package.json"), "utf8")
          )
          found.set(fs.realpathSync(location), {
            location: fs.realpathSync(location),
            name: manifest.name,
            version: manifest.version,
          })
        }
      }
    }
  }
  return [...found.values()]
}
const packages = installedPackages()
test("every reviewed dependency version is installed", () => {
  for (const pkg of packages) {
    if (
      (pkg.name === "glob" || pkg.name === "minimatch") &&
      Number(pkg.version.split(".")[0]) >= 9 &&
      Number(pkg.version.split(".")[0]) < (pkg.name === "glob" ? 14 : 11)
    ) {
      assert.ok(
        expected[pkg.name].includes(pkg.version),
        `unreviewed ${pkg.name}@${pkg.version}; check transitive overrides`
      )
    }
  }
  for (const [name, versions] of Object.entries(expected))
    for (const version of versions) {
      assert.ok(
        packages.some((p) => p.name === name && p.version === version),
        `missing ${name}@${version}; run a full frozen install`
      )
    }
})
for (const pkg of packages) {
  if (!expected[pkg.name].includes(pkg.version)) continue
  const label = `${pkg.name}@${pkg.version}`
  if (pkg.name === "minimatch")
    for (const format of ["commonjs", "esm"])
      test(`${label} ${format}: bounded preprocessing preserves ordinary matches`, () => {
        const entry = path.join(pkg.location, "dist", format, "index.js")
        const result = spawnSync(
          process.execPath,
          [
            "-e",
            `
      const assert = require('node:assert/strict');
      const { Minimatch } = require(${JSON.stringify(entry)});
      const options = { optimizationLevel: 2, braceExpandMax: 64 };
      const bounded = new Minimatch(Array(20).fill('**/../a/b').join('/'), options);
      assert.equal(bounded.set.length, 64);
      const ordinary = new Minimatch('**/../a/b/**/../c/d', options);
      assert.equal(ordinary.match('../a/b/../c/d'), true);
      assert.equal(ordinary.match('x/a/b/y/c/d'), true);
      const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
      assert.equal(large.set.length, 2000);
      assert.equal(large.match('y/999'), true);
      assert.equal(large.match('.y/5'), false);
    `,
          ],
          { timeout: 5000 }
        )
        assert.ifError(result.error)
        assert.equal(result.status, 0, result.stderr.toString())
      })
}
