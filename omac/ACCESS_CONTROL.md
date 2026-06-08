# Access Control Plugin

本项目通过 `.opencode/access-control.ts` 插件在工具执行前拦截高风险调用。插件由 `opencode.json` 注册，规则默认从 `.opencode/access-control.json` 读取。

实际生效文件：

- `opencode.json`：注册插件，并通过 `configFile` 指定规则文件。
- `.opencode/access-control.ts`：插件实现。
- `.opencode/access-control.json`：黑白名单规则。

修改 `opencode.json`、`.opencode/access-control.ts` 或 `.opencode/access-control.json` 后，需要重启 opencode 才会生效，因为配置和插件只在启动时加载一次。

## 与官方 permission 的关系

OpenCode 官方已经提供 `permission` 配置，用于按工具、命令、路径和外部目录控制 `allow`、`ask`、`deny`。因此，本插件的文件路径、目录路径和 shell 命令黑白名单能力，与官方 `permission` 存在较大重叠。

官方 `permission` 已覆盖的常见场景：

- 按工具设置权限，例如 `read`、`edit`、`glob`、`grep`、`bash`、`task`、`skill`。
- 按 `bash` 命令模式允许或拒绝，例如允许 `git status*`，拒绝 `git reset --hard*`。
- 按文件路径或通配模式控制读取和编辑，例如拒绝 `**/.env*`、`**/*.pem`。
- 通过 `external_directory` 控制工作目录之外的路径访问。
- 为不同 agent 覆盖权限。
- 使用 `ask` 进入交互式审批，并在当前会话中临时记住 `always` 选择。

本插件相对官方 `permission` 仍有少量额外能力：

- `strings` 会递归检查所有工具参数中的字符串，包括路径、命令、搜索词和补丁内容，适合做通用敏感词或凭据片段拦截。
- 支持 `re:<pattern>` 形式的 JavaScript 正则表达式规则；官方 `permission` 文档中的模式主要是 `*` 和 `?` 通配符。
- `deny` 永远优先于 `allow`；官方 `permission` 是最后匹配的规则优先。
- 规则可以放在独立的 `.opencode/access-control.json` 文件中，而不是集中写入 `opencode.json`。
- 命中规则后直接抛错阻断，不进入官方 `ask` 审批流程。

如果只需要控制工具、路径、命令或外部目录访问，优先使用官方 `permission`。只有在需要全参数敏感字符串扫描、正则匹配、独立规则文件或硬拒绝行为时，才建议继续使用本插件。

官方 `permission` 示例：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": {
      "*": "allow",
      "**/.env*": "deny",
      "**/*.pem": "deny",
      "**/*.key": "deny"
    },
    "edit": {
      "*": "ask",
      "**/.env*": "deny",
      "**/*.pem": "deny",
      "**/*.key": "deny"
    },
    "bash": {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "rm *": "deny",
      "git reset --hard*": "deny",
      "git checkout --*": "deny",
      "git clean *": "deny"
    },
    "external_directory": {
      "*": "ask"
    }
  }
}
```

## opencode.json 示例

推荐只在 `opencode.json` 中保留插件入口和规则文件路径：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "./.opencode/access-control.ts",
      {
        "configFile": ".opencode/access-control.json"
      }
    ]
  ]
}
```

`configFile` 支持相对路径和绝对路径。相对路径按插件上下文里的 `directory` 解析。

## 完整规则示例

下面是一份比较完整的 `.opencode/access-control.json` 示例。可以按需删减，空数组表示该类别不启用对应黑名单或白名单。

```json
{
  "tools": {
    "read": ["read", "glob", "grep", "list", "lsp"],
    "shell": ["bash"]
  },
  "strings": {
    "allow": [],
    "deny": [
      ".env",
      "id_rsa",
      "password",
      "secret",
      "token",
      "api_key",
      "private_key",
      "re:\\b(AKIA|ASIA)[A-Z0-9]{16}\\b"
    ]
  },
  "files": {
    "allow": [
      "**/*.ts",
      "**/*.js",
      "**/*.json",
      "**/*.md",
      "opencode.json",
      ".opencode/**"
    ],
    "deny": [
      "**/.env*",
      "**/*secret*",
      "**/*password*",
      "**/*private-key*",
      "**/*.pem",
      "**/*.key",
      "**/id_rsa",
      "**/id_ed25519"
    ]
  },
  "folders": {
    "allow": [
      ".opencode/**",
      "src/**",
      "test/**",
      "tests/**",
      "docs/**"
    ],
    "deny": [
      "**/.git/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/secrets/**",
      "**/.ssh/**"
    ]
  },
  "commands": {
    "allow": [
      "npm *",
      "node *",
      "git status*",
      "git diff*",
      "git log*",
      "rg *",
      "tsc *"
    ],
    "deny": [
      "rm *",
      "del *",
      "Remove-Item *",
      "git reset --hard*",
      "git checkout --*",
      "git clean *",
      "curl *",
      "wget *"
    ]
  }
}
```

如果只想启用黑名单，不想限制允许范围，把所有 `allow` 保持为空数组即可。

如果配置文件为空文件，插件会按空规则处理，等价于不启用任何黑白名单。

## 配置项说明

`strings` 用于检查工具参数里的所有字符串。它会覆盖搜索关键字、命令内容、路径字符串、补丁文本等所有字符串参数。这个规则最严格，适合拦截敏感词、密钥格式、凭据片段。

`files` 用于检查文件路径参数。当前会检查 `filePath`、`path`、`workdir` 这些参数，并只对判断为文件的路径应用该规则。

`folders` 用于检查目录路径参数。当前会检查 `filePath`、`path`、`workdir` 这些参数，包括文件所在路径是否命中被拒绝的目录模式。

`commands` 用于检查 `bash` 工具的 `command` 字符串。适合拦截破坏性命令或网络命令。

`tools` 用于配置哪些工具会触发路径类规则和命令类规则：

- `tools.read`：触发 `files` 和 `folders` 检查的工具列表，默认是 `["read", "glob", "grep", "list", "lsp"]`。
- `tools.shell`：触发 `commands` 检查的工具列表，默认是 `["bash"]`。

这里的 `"bash"` 是 opencode 的 shell 工具 ID，不是系统上的 bash 可执行文件。Windows 上实际执行的 shell 可以是 PowerShell，但插件钩子里看到的工具名仍按 opencode 工具 ID 匹配。官方插件示例也是用 `input.tool === "bash"` 判断 shell 工具。

如果不配置 `tools`，插件使用默认工具组。如果配置为空数组，则表示该工具组不启用。例如禁用命令检查：

```json
{
  "tools": {
    "shell": []
  }
}
```

每个类别都支持两个字段：

- `deny`：黑名单，表示“禁止”。命中任意 `deny` 规则会立即拒绝。
- `allow`：白名单，表示“仅允许”。非空时，所有被检查值都必须命中至少一条 `allow` 规则。

`deny` 永远优先于 `allow`。同一个值同时命中 `allow` 和 `deny` 时，最终仍然拒绝。

## 匹配语法

普通文本执行大小写不敏感的包含匹配：

```json
{
  "strings": {
    "deny": ["secret"]
  }
}
```

`*` 匹配任意字符。路径模式下，`*` 不跨 `/`：

```json
{
  "files": {
    "deny": ["*.pem", "**/*.key"]
  }
}
```

`**` 可以跨目录层级：

```json
{
  "folders": {
    "deny": ["**/.git/**", "**/node_modules/**"]
  }
}
```

`?` 匹配单个字符。路径模式下，`?` 不跨 `/`：

```json
{
  "files": {
    "deny": ["**/backup-202?-*.zip"]
  }
}
```

`re:<pattern>` 使用 JavaScript 正则表达式：

```json
{
  "strings": {
    "deny": ["re:\\b(passwd|pwd)\\b"]
  }
}
```

JSON 字符串里的反斜杠需要转义，所以正则中的 `\b` 要写成 `\\b`。

## 常见场景

只禁止读取敏感文件：

```json
{
  "files": {
    "deny": ["**/.env*", "**/*.pem", "**/*.key", "**/id_rsa"]
  }
}
```

只禁止访问依赖和 Git 元数据目录：

```json
{
  "folders": {
    "deny": ["**/.git/**", "**/node_modules/**"]
  }
}
```

只允许读写项目源码和文档范围内的文件：

```json
{
  "files": {
    "allow": ["src/**", "test/**", "tests/**", "docs/**", ".opencode/**", "opencode.json"]
  },
  "folders": {
    "allow": ["src/**", "test/**", "tests/**", "docs/**", ".opencode/**"]
  }
}
```

禁止破坏性命令：

```json
{
  "commands": {
    "deny": [
      "rm *",
      "del *",
      "Remove-Item *",
      "git reset --hard*",
      "git checkout --*",
      "git clean *"
    ]
  }
}
```

限制命令只能执行常见只读 Git 命令和 Node 构建命令：

```json
{
  "commands": {
    "allow": ["git status*", "git diff*", "git log*", "npm *", "node *", "tsc *"],
    "deny": ["git reset --hard*", "git checkout --*", "git clean *"]
  }
}
```

## 内联规则覆盖

通常推荐把规则放在 `.opencode/access-control.json`。如果确实需要临时覆盖某个类别，也可以在 `opencode.json` 的插件参数里直接写规则。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "./.opencode/access-control.ts",
      {
        "configFile": ".opencode/access-control.json",
        "tools": {
          "shell": ["bash"]
        },
        "commands": {
          "deny": ["rm *", "git reset --hard*"]
        }
      }
    ]
  ]
}
```

内联类别规则会覆盖配置文件中同一类别的同名字段。例如上面的 `commands.deny` 会覆盖 `.opencode/access-control.json` 中的 `commands.deny`。

## 注意事项

`strings` 会检查所有字符串参数，包括编辑补丁内容。如果把常见词放到 `strings.deny`，可能会导致后续无法通过工具编辑包含这些词的配置或代码。

`files` 和 `folders` 只检查工具参数中的路径字段，不会检查命令字符串中的路径。命令字符串需要通过 `commands` 或 `strings` 控制。

规则文件读取失败或 JSON 格式错误时，插件初始化会失败。这是有意设计，避免规则没有加载却静默放行。

配置变更后必须重启 opencode，当前运行会话不会热更新规则。
