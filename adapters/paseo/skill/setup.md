<!-- The Paseo adapter's /laoshi-setup sections (laoshi M2e): paseo.json and its helper scripts. -->
<!-- fragment: workspaceRow -->
| `paseo.json` | Paseo 的工作区设置（推荐）：新建 worktree 时自动安装依赖、复制本地配置；把常驻服务定义为由 Paseo 管理的服务，每个 worktree 分到独立的端口 | Paseo；流水线在服务启动和验证前通过 Paseo 启动这些服务 |
<!-- fragment: workspaceCheck -->
- 生成了 `paseo.json` 的服务定义时，设置环境变量 `PASEO_PORT=<一个空闲端口>` 后手工跑一遍它的启动命令（`node scripts/paseo/with-port.mjs …`），确认服务确实监听这个端口，再关掉。准备命令也照样跑一遍（`copy-local-files.mjs` 需要设置 `PASEO_SOURCE_CHECKOUT_PATH`）。
<!-- fragment: workspaceWrite -->
- `paseo.json`（Paseo 读取，格式见 Paseo 文档的 Git worktrees 一节）。它会提交、整个团队共用，而团队成员的电脑可能是 macOS、Linux 或 Windows，Paseo 在各系统上用不同的 shell 执行其中的命令（macOS/Linux：bash 和 sh；Windows：准备命令用 PowerShell、脚本用 cmd.exe）。所以**命令一律写成各系统都一样的形式**：只调用程序本身（`npm`、`pnpm`、`node`、`python` 等），不用 shell 的语法——不写 `$变量`、`%变量%`、`$env:变量`，不用 `&&`、`||`、`cp`、`[ -f … ]`、`Copy-Item`。需要读环境变量或判断文件的逻辑交给下面两个脚本：
  - 把 `{{REQ_KIT_ROOT}}/adapters/paseo/skill/templates/` 中的 `with-port.mjs` 和 `copy-local-files.mjs` 复制到项目的 `scripts/paseo/`（已有就比较，内容相同不动），和 `paseo.json` 一起提交。它们只依赖 Node.js（laoshi 本来就需要）。
  - `worktree.setup`：写成数组，一行一条命令。通常是安装依赖（用锁文件对应的命令，例如 `npm ci`、`pnpm install --frozen-lockfile`），以及复制不提交的本地配置：`node scripts/paseo/copy-local-files.mjs .env config/local.json`（来源目录里没有的文件会跳过，不会报错）。
  - `scripts`：常用的命令写成脚本（如 `test`、`lint`）；常驻服务写成 `"type": "service"`，必须监听 Paseo 分配的端口，不要写死。写法：`node scripts/paseo/with-port.mjs npm run dev -- --port {PORT}`（`{PORT}` 换成 Paseo 分配的端口，同时设置环境变量 `PORT`）；程序本来就读取 `PORT` 环境变量的，`node scripts/paseo/with-port.mjs npm start` 即可。服务之间互相调用的地址，让程序读取环境变量 `PASEO_SERVICE_<名称>_URL`。
  - 例子：

    ```json
    {
      "worktree": { "setup": ["npm ci", "node scripts/paseo/copy-local-files.mjs .env"] },
      "scripts": {
        "test": { "command": "npm test" },
        "web": { "type": "service", "command": "node scripts/paseo/with-port.mjs npm run dev -- --port {PORT}" }
      }
    }
    ```
  - 团队确定只用一种系统、并且用户明确要求时，才可以用那种系统的 shell 写法；`/laoshi-doctor` 会提示它在其他系统上不能用。
  - 已有 `paseo.json` 时只补充缺少的部分，不改别人写的内容。
  - 在 `verify.md` 的启动服务一节注明：服务已定义在 `paseo.json`，由流水线通过 Paseo 启动；同时保留手工启动的命令，供没有 Paseo 时使用。
<!-- fragment: workspaceCommit -->
`paseo.json` 必须提交：Paseo 新建 worktree 时读取的是基准分支上已提交的版本。
