# 快速开始

从安装到第一个需求，大约 15 分钟。每台机器只需安装一次，装在运行 agent 平台（Paseo 或 DeepSeek Harness）的那台机器上。

## 1. 安装

只需要 Node.js 22.19+ 和能访问的 npm 源：

::: code-group

```sh [DeepSeek Harness]
npx -y @yiyi_zhang/laoshi@latest install --platform dsh
```

```sh [Paseo]
npx -y @yiyi_zhang/laoshi@latest install --platform paseo
```

```sh [公司内网（npm 镜像）]
npx -y --registry=https://npm.example.internal/ @yiyi_zhang/laoshi@latest install --platform dsh
```

:::

Windows 上在 cmd 或 Git Bash 中运行即可，不需要 PowerShell，也不需要管理员权限。公司内网只有 npm 镜像时，用 `--registry` 写上镜像地址，它会保存为本机的 npm 源，以后 `laoshi upgrade` 也从镜像取。

安装会依次：

1. 检查 Node.js、npm 和 git，确定 npm 源；
2. 从 npm 安装 `laoshi`（npm 全局目录不可写时装到 `~/.laoshi/npm`，不需要 sudo）；
3. 写好安装根 `~/.laoshi` 和安装级配置（平台、各角色用的模型）；
4. 把 `/laoshi` 等 skill 按平台渲染后装进平台的 skill 目录（不覆盖别人放的同名 skill）；
5. 做平台需要的设置：dsh 上安装并挂载 laoshi 的 dsh 插件；
6. 在 `~/.laoshi/bin` 中放好 `laoshi` 命令。

再次运行同一条命令即升级（或运行 `laoshi upgrade`）。装好后运行 `laoshi docs` 可以在本机打开这份文档（和装的版本一致，不需要外网）。

::: tip 没有 npm 源时
完全离线的机器用带依赖的离线安装包，见 [内网安装与验证](./intranet)。各项选项见 [安装与升级](./install)。
:::

## 2. 体检

```sh
laoshi doctor --no-project
```

它检查安装、配置、平台（Paseo daemon 或 dsh 插件）、各角色的模型。全部是 ✓ 或只有 ⚠ 即可继续；✗ 的项按提示处理。

::: details `laoshi` 命令找不到？
npm 的全局目录不在 PATH 中时，使用安装根中的命令：`~/.laoshi/bin/laoshi`（Windows 上是 `%USERPROFILE%\.laoshi\bin\laoshi.cmd`），或把那个目录加进 PATH。
:::

## 3. 接入项目（每个项目一次）

在平台中打开项目主目录（最好在主分支上），新开对话，输入：

```text
/laoshi-setup
```

agent 会读项目、只问读不出来的事、把安装依赖/测试/启动服务的命令实际跑一遍，然后生成并请你确认这些文件：

| 文件 | 作用 |
| --- | --- |
| `.requirement-pipeline/project-notes.md` | 项目约定：包管理工具、不能改的目录、提交格式 |
| `.requirement-pipeline/verify.md` | 验证方法：实际跑通的安装、测试、启动命令 |
| `paseo.json`（Paseo）或 `.laoshi/services.json`（dsh 等） | 新建工作区时自动准备环境；服务由平台或 laoshi 托管，每个工作区独立端口 |

## 4. 提第一个需求

在项目的对话中输入 `/laoshi` 和一句话：

```text
/laoshi 登录页增加短信验证码登录
```

接下来：

1. AI 复述理解，一次问一个问题；拿不准时说"你定"。
2. 标准档会请另一个模型独立审阅需求说明，把发现的问题逐个问你。
3. 确认需求说明后，选择现在开始或预约时间（例如今晚 10 点）。
4. 开发在后台进行，每一步都出现在对话的子 agent 列表中；你会收到几句进展。
5. 完成后收到结论和报告，说"我要验收"，按验收标准逐条核对。

::: tip 从一个小需求开始
第一次建议用一个范围很小的改动（例如改一段文案），走快速档，十几分钟就能看到完整的流程。
:::

## 下一步

- [使用者指南](./user)：过程中可以说什么、会收到哪些通知、怎么验收。
- [工作原理](./how-it-works)：流水线的每一步做什么、产物在哪里。
- [项目定制与运行规则](./project)：档位、评审小组、分阶段执行、通知等配置。
