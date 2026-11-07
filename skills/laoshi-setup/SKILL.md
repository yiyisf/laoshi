---
name: laoshi-setup
description: laoshi 项目接入。在项目根目录为 laoshi 生成或更新项目说明、验证方法（实际运行其中的命令）、工作区设置和项目配置，确认后提交。新项目第一次使用 /laoshi 之前、项目的构建或测试方式变了、或用户输入 /laoshi-setup 时使用。
metadata:
  opencode/slash: "true"
---

# laoshi 项目接入（{{REQ_KIT_VERSION}}）

为当前项目生成以下文件，让流水线的每个步骤不必每次重新摸索这个项目：

| 文件 | 内容 | 谁读 |
| --- | --- | --- |
| `.requirement-pipeline/project-notes.md` | 本项目的约定：包管理工具、目录结构、不能改的地方、提交信息格式、已知的坑 | 流水线每个步骤、`/laoshi` 访谈前 |
| `GLOSSARY.md` | 术语表（推荐）：业务词、含义、代码中的名字。访谈和方案设计会继续补充 | `/laoshi` 访谈、流水线每个步骤 |
| `.requirement-pipeline/verify.md` | 验证方法：安装依赖、启动服务、运行测试、准备测试数据，命令都实际跑过 | 实现、修复、服务启动、验证、复验步骤 |
{{fragment.workspaceRow}}
| `.laoshi.json` | 项目配置：**质量门的检查命令**（`checks`，推荐）、关联仓库（`relatedRepos`，有就写）；本项目用的 agent、默认档位、轮数、超时（需要时） | 流水线 |

格式见 `{{REQ_KIT_ROOT}}/contracts/verify.md`。这个入口通常由开发同事或熟悉项目的测试同事运行。

{{fragment.firstUse}}

## 步骤

1. 确认位置
2. 自己读项目
3. 只问读不出来的事
4. 实际运行验证命令
5. 写文件并展示
6. 确认后提交

## 1. 确认位置

在项目的根目录（git 仓库根）运行。用 `git rev-parse --show-toplevel` 确认当前目录就是仓库根；不是的话，告诉用户到仓库根目录的对话中运行。不要 `cd` 到别处。

建议在项目主目录、主分支上运行，这样文件提交后，之后从主分支新建的 worktree 都会带上。当前在某个需求的 worktree 中时，提醒用户：提交只在这个分支上，合并后其他需求才能用到。

已经有这些文件时，这次是更新：读出现有内容，只改过时或缺失的部分，最后以差异形式展示。

## 2. 自己读项目

先读，不要先问：

- `README`、`CONTRIBUTING`、`AGENTS.md`、`CLAUDE.md`、`docs/` 下的开发文档
- 包管理与脚本：`package.json`（scripts、packageManager、engines）、锁文件类型、`Makefile`、`justfile`、`pyproject.toml`、`go.mod`、`pom.xml`、`build.gradle`、`Cargo.toml` 等
- 测试：测试框架和配置、测试目录、端到端测试工具（Playwright、Cypress 等）
- 运行：`docker-compose.yml`、`.env.example`、启动脚本、`{{platform.servicesFile}}`
- CI 配置（`.github/workflows/` 等）：它跑的命令通常就是最可靠的验证命令
- 提交历史：`git log --oneline -20`，看提交信息的格式
- 功能目录中已有的 `service-start.md`、`verification.md` 里"建议写入 verify.md 的内容"一节（如有）

## 3. 只问读不出来的事

一次一个问题，给选项和推荐。通常只有这些需要问：

- 有没有不能改的目录或文件（例如生成的代码、第三方代码、迁移历史）
- 测试账号、测试数据从哪里来（只记录位置，不要把真实口令写进文件）
- 外部服务（短信、支付、邮件）在本地怎么替代
- 端到端验证用什么方式：现有工具，还是手工按步骤走
- 这个项目的需求默认走哪个档位，要不要换 agent（不需要就不写这些项）
- 有没有相关的其他仓库（例如这是前端，接口在另一个后端仓库）：在这台机器上的位置、它提供什么。登记后流水线的步骤可以只读参考它，不会改动它
- 多模块的仓库（例如 `web/` 和 `server/` 各有自己的测试）：确认各模块的检查命令，第 5 步按模块写进 `checks`
- 项目已经有 `{{platform.servicesFile}}` 时，要不要由你补充；没有时，要不要生成（推荐生成，见第 5 步）
- **从卡片接需求**（团队对接了需求管理系统时）：先执行 `node "{{REQ_KIT_ROOT}}/bin/req.mjs" card route`。输出"没有配置可以读取卡片的外部系统"或团队不用卡片开始需求时跳过；否则问：这个仓库属于需求管理系统中的哪个空间（项目编号，如 ALM 的 projectId）、接哪些子系统的卡片（卡片上显示的子系统名称，可以多个）；同一个子系统还有别的仓库时（例如前端和后端各一个），卡片标题中用什么词区分（例如服务名"message-service"、"后端"）。第 5 步写进 `cardSource`

## 4. 实际运行验证命令

按读到的做法，依次实际运行：安装依赖、构建或类型检查、代码检查、测试、启动服务并确认就绪、端到端检查（有的话）。每条记录：命令、所在目录、用时、结果（例如"412 个用例全部通过"）。

- 失败的命令不要写成可用。查明原因：是环境问题（缺少服务、缺少配置）就写明准备步骤后重试；是项目本身的问题就写进"已知问题"。
- 启动的服务、容器在结束前关掉。
{{fragment.toolsNote}}
{{fragment.workspaceCheck}}
- 不连接生产环境，不使用生产凭据，不触发真实的外部动作。

## 5. 写文件并展示

- `verify.md`：按 `{{REQ_KIT_ROOT}}/contracts/verify.md` 的结构，第一行之后写"最后核对：<日期>（/laoshi-setup，<全部命令已运行 / 哪些没能运行>）"。只写实际跑通的命令；跑不通的写在"已知问题"。
- `project-notes.md`：一条一行，只写对做需求有影响的约定。例如"包管理用 pnpm，不要用 npm""数据库变更必须写成 migrations/ 下的迁移脚本""不要改动 legacy/ 目录""提交信息用 Conventional Commits 格式"。再加一节**范例文件**：各类代码（接口、页面、数据访问、测试、迁移脚本等）在项目里写得最好的一个文件，例如"接口：`src/api/orders.ts`；单元测试：`test/api/orders.test.ts`"。方案设计会让每个任务照着范例写，代码更像项目原有的样子。只列你读过、确认写得规范的文件。
- `GLOSSARY.md`（仓库根目录）：项目还没有术语表时，从代码、文档和界面文字中整理主要的业务词，每条写含义和代码中的名字（类名、字段、接口路径或表名），格式见 `{{REQ_KIT_ROOT}}/skills/requirement-interview/SKILL.md` 的"术语"一节。已有的只补充"代码中的名字"等缺失的部分，不改别人写的含义。拿不准含义的不要写，留给访谈时问。
{{fragment.workspaceWrite}}
- `.laoshi.json`（laoshi 的项目配置；旧名 `.requirement-pipeline.json` 也能读，项目里已有旧名文件时就在旧文件里补充，不要两个都写：两个都在时只读 `.laoshi.json`）：
  - `checks`（推荐）：质量门的检查。流水线会在写代码和修复的步骤之后**自己运行**它们，只拦"改动之前通过、现在失败"的检查，并把输出发回给那一步的 agent 修复，不依赖 agent 自己说"测试通过了"。把第 4 步实际跑通、几分钟内能跑完的检查写进去：格式、lint、类型检查、单元测试、构建（端到端测试和需要启动服务的检查不要写，它们由功能验证负责）。命令同样写成各系统通用的形式。多模块的仓库按模块分开写，用 `cwd` 指定模块目录（这项检查只在该模块有改动时运行；需要更精确时用 `paths` 列出它关心的目录）：

    ```json
    {
      "checks": [
        { "name": "lint", "command": "npm run lint" },
        { "name": "web 测试", "command": "npm test", "cwd": "web" },
        { "name": "server 测试", "command": "npm test", "cwd": "server", "timeoutMinutes": 15 }
      ]
    }
    ```
  - `relatedRepos`（有关联仓库时）：`[{ "name": "后端", "path": "../backend", "role": "提供登录和订单接口" }]`。`path` 写相对项目目录的路径（团队约定把相关仓库放在同一个上级目录最方便），也可以写 `~/` 开头的路径。平时流水线的步骤只读不改；需求说明写了"联合开发"时，流水线会为这个需求在它那里新建工作区，一起开发。关联仓库最好也运行过 `/laoshi-setup`，它自己的检查命令、验证方法和项目说明会用在它的步骤里。
  - `cardSource`（第 3 步确认了从卡片接需求时）：`{ "system": "ALM", "projectId": "186149", "subsystems": ["CSP-CMASTER_云匠"], "titleKeywords": ["message-service"] }`。`system` 是团队对接配置中的系统名称；`titleKeywords` 只在同一子系统有几个仓库时写。之后 `req start --from` 不写仓库时，按卡片的子系统和标题选到这个仓库
  - 其他设置只在需要和本机配置不同时才写，例如 `"defaultProfile": "quick"`。不要写 `daemonUrl`、`daemonPasswordEnv`、`teamConfig`、`platform`、`user`，写了也会被忽略。
- `.gitignore`：确认包含 `docs/features/*/.pipeline/`（流水线的运行状态），没有就建议加上。

把这些文件的内容（更新时是差异）展示给用户，并说明运行验证的结果：哪些通过、哪些没能运行以及原因。

## 6. 确认后提交

用户确认后，只提交这几个文件（以及 `GLOSSARY.md`、复制进项目的辅助脚本和 `.gitignore` 的改动），提交信息例如 `chore(laoshi): 项目接入说明与验证方法`。不 push。

{{fragment.workspaceCommit}}

写了 `cardSource` 的，提交后执行 `node "{{REQ_KIT_ROOT}}/bin/req.mjs" card route --add .`，在这台机器上登记这个仓库接收卡片（每台接单的机器各登记一次）。

最后告诉用户：之后项目的构建、测试或启动方式有变化时，再运行一次 `/laoshi-setup`；也可以直接编辑这些文件。可以运行 `/laoshi-doctor` 确认项目检查全部正常。
