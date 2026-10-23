import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"

const source = resolve(import.meta.dirname, "../..")

function executableExamples(content) {
  return [...content.matchAll(/```(bash|sql)\n([\s\S]*?)```/g)].map(
    ([, language, body]) => [
      language,
      body
        .trim()
        .split("\n")
        .map((line) => line.replace(/\s+#.*$/, "").trimEnd())
        .join("\n"),
    ]
  )
}

function linkTargets(content) {
  return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map(([, target]) => target)
    .sort()
}

test("locale documentation preserves operational examples and link destinations", async () => {
  const documents = [
    "README.md",
    "AGENTS.md",
    ...(await readdir(resolve(source, "docs")))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `docs/${file}`),
  ]
  const localesDirectory = resolve(source, "template/locales")
  const entries = await readdir(localesDirectory, { withFileTypes: true })
  for (const entry of entries.filter((entry) => entry.isDirectory())) {
    const directory = resolve(localesDirectory, entry.name)
    const pack = JSON.parse(
      await readFile(resolve(directory, "pack.json"), "utf8")
    )
    const documentation = resolve(directory, pack.documentation)
    if (documentation === source) continue
    for (const document of documents) {
      const original = (await readFile(resolve(source, document), "utf8"))
        .replaceAll("\r\n", "\n")
        .replace(
          /<!-- template-maintainers:start -->[\s\S]*?<!-- template-maintainers:end -->\n*/g,
          ""
        )
      const translated = (
        await readFile(resolve(documentation, document), "utf8")
      ).replaceAll("\r\n", "\n")
      assert.deepEqual(
        executableExamples(translated),
        executableExamples(original),
        `Changed executable examples: ${entry.name}/${document}`
      )
      assert.deepEqual(
        linkTargets(translated),
        linkTargets(original),
        `Changed link destinations: ${entry.name}/${document}`
      )
    }
  }
})
