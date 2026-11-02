<!-- laoshi M2e: /laoshi-setup sections for platforms whose services and worktrees are laoshi's builtin ones (docs/design/builtin-capabilities.md). -->
<!-- fragment: workspaceRow -->
| `.laoshi/services.json` | 工作区设置（推荐）：laoshi 新建 worktree 时运行的准备命令（安装依赖、复制本地配置）；常驻服务的启动命令，由 laoshi 启动，每个 worktree 分到独立的端口 | 流水线：新建 worktree 时准备环境，服务启动和验证前启动这些服务 |
<!-- fragment: workspaceCheck -->
- 写了 `.laoshi/services.json` 的服务时，把命令中的 `{PORT}` 换成一个空闲端口、并设置环境变量 `PORT` 为同一个端口，手工跑一遍，确认服务确实监听这个端口（有 `health` 时访问一下它），再关掉。准备命令也照样跑一遍（`copy-local-files.mjs` 需要设置 `LAOSHI_SOURCE_CHECKOUT_PATH` 为来源目录）。
<!-- fragment: workspaceWrite -->
- `.laoshi/services.json`（laoshi 读取，格式见 `{{REQ_KIT_ROOT}}/docs/design/builtin-capabilities.md` 第 1 节）。它会提交、整个团队共用，命令在 Windows 上由 cmd.exe 执行、在其他系统上由 /bin/sh 执行（不会用 PowerShell），所以**命令一律写成各系统都一样的形式**：只调用程序本身（`npm`、`pnpm`、`node`、`python` 等），不用 shell 的语法——不写 `$变量`、`%变量%`，不用 `&&`、`||`、`cp`。
  - 需要从原来的检出复制不提交的本地配置时，把 `{{REQ_KIT_ROOT}}/skills/laoshi-setup/templates/copy-local-files.mjs` 复制到项目的 `scripts/laoshi/`（已有就比较，内容相同不动），和 `.laoshi/services.json` 一起提交。
  - `setup`：写成数组，一行一条命令。通常是安装依赖（用锁文件对应的命令，例如 `npm ci`），以及 `node scripts/laoshi/copy-local-files.mjs .env config/local.json`（来源目录里没有的文件会跳过）。
  - `services`：常驻服务，每个写 `command`，用 `{PORT}` 表示 laoshi 分配的端口（同时会设置环境变量 `PORT` 和 `LAOSHI_PORT`），不要写死端口；有健康检查地址的写 `health`（以 `/` 开头）。
  - 例子：

    ```json
    {
      "setup": ["npm ci", "node scripts/laoshi/copy-local-files.mjs .env"],
      "services": {
        "web": { "command": "npm run dev -- --port {PORT}", "health": "/healthz" }
      }
    }
    ```
  - 已有 `.laoshi/services.json` 时只补充缺少的部分，不改别人写的内容。
  - 在 `verify.md` 的启动服务一节注明：服务已定义在 `.laoshi/services.json`，由流水线启动；同时保留手工启动的命令。
<!-- fragment: workspaceCommit -->
`.laoshi/services.json` 必须提交：laoshi 新建 worktree 时，读取的是从基准分支检出的那一份。
