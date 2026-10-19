export const templateProfiles = [
  { id: "en", locales: ["en"], docsLocale: "en" },
  { id: "fr", locales: ["fr"], docsLocale: "fr" },
  { id: "multilingual", locales: ["en", "fr"], docsLocale: "en" },
]

if (import.meta.main) {
  const include = templateProfiles.flatMap(({ id, locales }) =>
    ["nestjs", "rust"].map((backend) => ({
      id,
      backend,
      artifact: backend === "nestjs" ? id : `${id}-${backend}`,
      locales: locales.join(","),
    }))
  )
  console.log(JSON.stringify({ include }))
}
