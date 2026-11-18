import ts from "typescript"

// Count occupied source lines, preserving strings and JSX text while omitting trivia.
function typescriptLines(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const lines = new Set()
  function visit(node) {
    const children = node.getChildren(file)
    if (children.length) {
      children.forEach(visit)
      return
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return
    const start = node.getStart(file)
    const firstLine = file.getLineAndCharacterOfPosition(start).line
    source
      .slice(start, node.end)
      .split(/\r\n|\n|\r/)
      .forEach((line, index) => {
        if (line.trim()) lines.add(firstLine + index)
      })
  }
  visit(file)
  return lines.size
}

// Rust needs nested block comments, raw strings, lifetimes and character literals.
// CSS uses the same block-comment and quoted-string handling.
function otherSourceLines(source, css) {
  const lines = new Set()
  let line = 0
  let blocks = 0
  let quoted = null
  let rawEnd = null
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const rest = source.slice(index)
    if (char === "\n") {
      line++
      continue
    }
    if (rawEnd) {
      if (char.trim()) lines.add(line)
      if (rest.startsWith(rawEnd)) {
        index += rawEnd.length - 1
        rawEnd = null
      }
    } else if (quoted) {
      if (char.trim()) lines.add(line)
      if (char === "\\" && source[index + 1] !== "\n") index++
      else if (char === quoted) quoted = null
    } else if (blocks) {
      if (rest.startsWith("/*")) {
        if (!css) blocks++
        index++
      } else if (rest.startsWith("*/")) {
        blocks--
        index++
      }
    } else if (!css && rest.startsWith("//")) {
      const end = source.indexOf("\n", index)
      index = (end === -1 ? source.length : end) - 1
    } else if (rest.startsWith("/*")) {
      blocks++
      index++
    } else {
      if (char.trim()) lines.add(line)
      const raw = rest.match(/^r(#+)?"/)
      if (raw) {
        rawEnd = `"${raw[1] ?? ""}`
        index += raw[0].length - 1
      } else if (
        char === '"' ||
        (char === "'" && (css || /^'(?:\\.|[^'\n])'/.test(rest)))
      ) {
        quoted = char
      }
    }
  }
  return lines.size
}

export function countSourceLines(source, path) {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)
    ? typescriptLines(source, path)
    : otherSourceLines(source, path.endsWith(".css"))
}
