import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { isAbsolute, resolve } from "path"

type RuleValue = string | readonly string[]

type RuleList = {
  readonly allow?: RuleValue
  readonly deny?: RuleValue
}

type ToolGroups = {
  readonly read?: RuleValue
  readonly shell?: RuleValue
}

type NormalizedRuleList = {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
}

const CATEGORIES = ["strings", "files", "folders", "commands"] as const
type Category = (typeof CATEGORIES)[number]

type AccessControlConfig = Partial<Record<Category, RuleList>> & {
  readonly configFile?: string
  readonly tools?: ToolGroups
}

type MutableAccessControlConfig = Partial<Record<Category, RuleList>> & {
  configFile?: string
  tools?: ToolGroups
}

type NormalizedConfig = Record<Category, NormalizedRuleList>
type NormalizedToolGroups = {
  readonly read: ReadonlySet<string>
  readonly shell: ReadonlySet<string>
}

type ToolArgs = Record<string, unknown>
type AccessViolationKind = "deny" | "allow"

const PATH_ARG_KEYS = ["filePath", "path", "workdir"] as const
const COMMAND_ARG_KEYS = ["command"] as const

const DEFAULT_TOOL_GROUPS = {
  read: ["read", "glob", "grep", "list", "lsp"],
  shell: ["bash"],
} as const satisfies Record<keyof NormalizedToolGroups, readonly string[]>

class AccessError extends Error {
  readonly category: string
  readonly kind: AccessViolationKind
  readonly tool: string
  readonly value: string
  readonly rule?: string

  constructor(input: {
    readonly category: string
    readonly kind: AccessViolationKind
    readonly tool: string
    readonly value: string
    readonly rule?: string
  }) {
    super(`Access denied by ${input.category} ${input.kind} rule "${input.rule ?? input.kind}" for ${input.tool}: ${input.value}`)
    this.name = "AccessError"
    this.category = input.category
    this.kind = input.kind
    this.tool = input.tool
    this.value = input.value
    this.rule = input.rule
  }
}

function loadConfig(options: unknown, directory: string): AccessControlConfig {
  const inlineConfig = toAccessControlConfig(options)
  const configFile = inlineConfig.configFile
  if (!configFile) {
    return inlineConfig
  }

  const filePath = isAbsolute(configFile) ? configFile : resolve(directory, configFile)
  const content = readFileSync(filePath, "utf8").trim()
  const fileConfig = content ? toAccessControlConfig(JSON.parse(content) as unknown) : {}
  return mergeConfig(fileConfig, inlineConfig)
}

function toAccessControlConfig(value: unknown): AccessControlConfig {
  if (!isObjectRecord(value)) {
    return {}
  }

  const config: MutableAccessControlConfig = {}
  if (typeof value.configFile === "string" && value.configFile.trim()) {
    config.configFile = value.configFile
  }
  config.tools = toToolGroups(value.tools)

  for (const category of CATEGORIES) {
    const rules = toRuleList(value[category])
    if (rules) {
      config[category] = rules
    }
  }
  return config
}

function toToolGroups(value: unknown): ToolGroups | undefined {
  if (!isObjectRecord(value)) {
    return undefined
  }

  return {
    read: toRuleValue(value.read),
    shell: toRuleValue(value.shell),
  }
}

function toRuleList(value: unknown): RuleList | undefined {
  if (!isObjectRecord(value)) {
    return undefined
  }

  return {
    allow: toRuleValue(value.allow),
    deny: toRuleValue(value.deny),
  }
}

function toRuleValue(value: unknown): RuleValue | undefined {
  if (typeof value === "string") {
    return value
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0)
  }
  return undefined
}

function mergeConfig(base: AccessControlConfig, override: AccessControlConfig): AccessControlConfig {
  const merged: MutableAccessControlConfig = { ...base, ...override }
  for (const category of CATEGORIES) {
    merged[category] = mergeRuleList(base[category], override[category])
  }
  merged.tools = mergeToolGroups(base.tools, override.tools)
  return merged
}

function mergeToolGroups(base: ToolGroups | undefined, override: ToolGroups | undefined): ToolGroups | undefined {
  if (!base) {
    return override
  }
  if (!override) {
    return base
  }
  return { ...base, ...override }
}

function mergeRuleList(base: RuleList | undefined, override: RuleList | undefined): RuleList | undefined {
  if (!base) {
    return override
  }
  if (!override) {
    return base
  }
  return { ...base, ...override }
}

function normalizeConfig(config: AccessControlConfig): NormalizedConfig {
  return {
    strings: normalizeRuleList(config.strings),
    files: normalizeRuleList(config.files),
    folders: normalizeRuleList(config.folders),
    commands: normalizeRuleList(config.commands),
  }
}

function normalizeToolGroups(config: AccessControlConfig): NormalizedToolGroups {
  return {
    read: new Set(normalizeToolGroup(config.tools?.read, DEFAULT_TOOL_GROUPS.read)),
    shell: new Set(normalizeToolGroup(config.tools?.shell, DEFAULT_TOOL_GROUPS.shell)),
  }
}

function normalizeToolGroup(value: RuleValue | undefined, fallback: readonly string[]): readonly string[] {
  return value === undefined ? fallback : normalizeRuleValue(value)
}

function normalizeRuleList(rules: RuleList | undefined): NormalizedRuleList {
  return {
    allow: normalizeRuleValue(rules?.allow),
    deny: normalizeRuleValue(rules?.deny),
  }
}

function normalizeRuleValue(value: RuleValue | undefined): readonly string[] {
  if (!value) {
    return []
  }
  return typeof value === "string" ? [value] : value
}

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") {
    result.push(value)
    return result
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, result))
    return result
  }
  if (isObjectRecord(value)) {
    Object.values(value).forEach((item) => collectStrings(item, result))
  }
  return result
}

function collectArgValues(args: ToolArgs, keys: readonly string[]): string[] {
  return keys.flatMap((key) => collectStrings(args[key]))
}

function normalizePathLike(value: string): string {
  return value.replaceAll("\\", "/")
}

function isFolderPath(value: string): boolean {
  const normalized = normalizePathLike(value)
  return normalized.endsWith("/") || !/\/[^/]+\.[^/]+$/.test(normalized)
}

function wildcardToRegExp(pattern: string, pathMode: boolean): RegExp {
  const normalized = normalizePathLike(pattern)
  let source = ""

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    const afterNext = normalized[index + 2]

    if (pathMode && char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?"
      index += 2
      continue
    }
    if (char === "*" && next === "*") {
      source += "[\\s\\S]*"
      index += 1
      continue
    }
    if (char === "*") {
      source += pathMode ? "[^/]*" : "[\\s\\S]*"
      continue
    }
    if (char === "?") {
      source += pathMode ? "[^/]" : "[\\s\\S]"
      continue
    }

    source += escapeRegExp(char)
  }

  return new RegExp(`^${source}$`, "i")
}

function matchesRule(value: string, rule: string, pathMode: boolean): boolean {
  const text = normalizePathLike(value)
  const pattern = normalizePathLike(rule)

  if (pattern.startsWith("re:")) {
    return new RegExp(pattern.slice(3), "i").test(text)
  }
  if (pattern.includes("*") || pattern.includes("?")) {
    return wildcardToRegExp(pattern, pathMode).test(text)
  }
  return text.toLowerCase().includes(pattern.toLowerCase())
}

function assertAllowed(
  category: string,
  values: readonly string[],
  rules: NormalizedRuleList,
  tool: string,
  pathMode = false,
): void {
  for (const value of values) {
    const deniedBy = rules.deny.find((rule) => matchesRule(value, rule, pathMode))
    if (deniedBy) {
      throw new AccessError({ category, kind: "deny", rule: deniedBy, tool, value })
    }
  }

  if (rules.allow.length === 0) {
    return
  }

  for (const value of values) {
    const allowed = rules.allow.some((rule) => matchesRule(value, rule, pathMode))
    if (!allowed) {
      throw new AccessError({ category, kind: "allow", tool, value })
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&")
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const AccessControl: Plugin = async ({ directory }, options) => {
  const config = loadConfig(options, directory)
  const rules: NormalizedConfig = normalizeConfig(config)
  const tools = normalizeToolGroups(config)

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      const args: ToolArgs = output.args ?? {}

      assertAllowed("string", collectStrings(args), rules.strings, tool)

      if (tools.read.has(tool)) {
        const paths = collectArgValues(args, PATH_ARG_KEYS).map(normalizePathLike)
        assertAllowed("file", paths.filter((path) => !isFolderPath(path)), rules.files, tool, true)
        assertAllowed("folder", paths, rules.folders, tool, true)
      }

      if (tools.shell.has(tool)) {
        assertAllowed("command", collectArgValues(args, COMMAND_ARG_KEYS), rules.commands, tool)
      }
    },
  }
}

export default AccessControl
