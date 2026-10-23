export type SeedOperation = () => Promise<void>

export interface SeedScenario {
  readonly name: string
  prepareSeed: () => Promise<SeedOperation>
  prepareClean: () => Promise<SeedOperation>
}

export type SeedCommand = Readonly<{
  clean: boolean
  selection:
    | Readonly<{ kind: "all" }>
    | Readonly<{ kind: "scenario"; name: string }>
}>

export async function runSeedCommand(
  command: SeedCommand,
  registry: ReadonlyArray<SeedScenario>
) {
  const names = new Set<string>()
  for (const scenario of registry) {
    if (scenario.name.trim().length === 0)
      throw new Error("Seed scenario names must not be empty")
    if (names.has(scenario.name))
      throw new Error(`Duplicate seed scenario: ${scenario.name}`)
    names.add(scenario.name)
  }

  let selected: Array<SeedScenario>
  if (command.selection.kind === "all") {
    selected = [...registry]
  } else {
    const selectedName = command.selection.name
    selected = registry.filter((scenario) => scenario.name === selectedName)
  }
  if (selected.length === 0) {
    const selectedName =
      command.selection.kind === "scenario" ? command.selection.name : "all"
    throw new Error(`Unknown seed scenario: ${selectedName}`)
  }
  if (command.clean) selected.reverse()
  const prepare = command.clean ? "prepareClean" : "prepareSeed"
  const operations = await Promise.all(
    selected.map((scenario) => scenario[prepare]())
  )
  for (const operation of operations) await operation()
}
