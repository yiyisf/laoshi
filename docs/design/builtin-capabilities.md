# laoshi 内置能力：worktree、服务、本机调度

- 状态：worktree 与服务**已实现**（M2b，`engine/src/builtin/`）；本机调度**已设计，未实现**
- 依据：[ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md) 决定 3
- 相关：[adapter-guide §2](adapter-guide.md)、[dsh-adapter](dsh-adapter.md)

这三项能力与平台无关。req-kit 里它们由 Paseo 提供；换到别的平台时，laoshi 自己实现一次，不让每个适配器各写一遍。适配器在能力声明里把来源写成 `builtin` 就会用上这些实现：运行时层（`runtime-loader.ts`）先用内置实现替换适配器运行时里对应的方法（`withBuiltins`），再统一降级仍然缺失的能力（`withCapabilities`）。Paseo 适配器继续使用 Paseo 自己的工作区、`paseo.json` 服务和定时任务；dsh 适配器的 worktree 和服务用内置实现。

## 1. 代码库里的定义：`.laoshi/services.json`

按 [ADR 0007](../adr/0007-one-install-many-repos.md)，代码库里只放专属配置。服务和新工作区的准备命令写在 `.laoshi/services.json`，要提交到仓库：

```json
{
  "setup": ["npm ci", "node scripts/copy-env.mjs"],
  "services": {
    "web": { "command": "npm run dev -- --port {PORT}", "health": "/healthz" },
    "api": { "command": "node server.js", "port": 4100 }
  }
}
```

- `setup`：新建 worktree 后按顺序执行。一条失败就停下，后面的不再执行。可以只写一条字符串。
- `services.<名称>.command`：启动服务的命令。
- `port`：可选。不写时 laoshi 分配一个空闲端口，同一工作区以后沿用这个端口（只要它还空着），这样服务的地址不会变；写了就用固定端口，被占用时报错。
- `health`：可选，以 `/` 开头的 HTTP 路径。写了就以 HTTP 回应码低于 500 为就绪；没写时，端口能连上就算就绪。
- 端口的传法：命令里的 `{PORT}` 会被替换成端口号，同时设置环境变量 `PORT` 和 `LAOSHI_PORT`。
- 准备命令可以读到两个环境变量：`LAOSHI_SOURCE_CHECKOUT_PATH`（对话所在的原仓库）和 `LAOSHI_WORKTREE_PATH`（新工作区）。

**shell**：命令用系统默认的 shell 执行，Windows 上是 `cmd.exe`，其他系统是 `/bin/sh`。**任何情况下都不启动 PowerShell**，因为内网机器上它会被直接禁止运行。所以命令最好写成普通的程序调用，例如 `node scripts/x.mjs`，在各个系统上都一样能用。`/req-setup` 的两个辅助脚本（`with-port.mjs`、`copy-local-files.mjs`）现在也认 `LAOSHI_PORT` 和 `LAOSHI_SOURCE_CHECKOUT_PATH`。

`laoshi doctor` 的项目一节会检查这个文件：格式、服务是否用了分配的端口、文件是否已提交（只在平台用内置能力时检查）。

## 2. worktree（已实现）

- **新建**（`createWorktree`）：运行 `git worktree add -b <分支> <目录> <起点>`，目录在安装目录下：`<kitHome>/worktrees/<仓库名>-<哈希>/<分支>`。`kitHome` 目前是 `REQ_KIT_HOME`，没有设置时为 `~/.req-kit`；到 M2c 改为 `LAOSHI_HOME`。
- **工作区 ID**：`dir:` 加上目录的真实路径，任何进程拿到它都能找回目录。引擎把工作区 ID 当作不透明的字符串保存在状态里，不需要改动。
- **准备命令**：在后台运行（`setup-runner.mjs`，只依赖 `node`），所以新建工作区的启动器不必等它。状态和输出记在 `<kitHome>/workspaces/<目录名>-<哈希>/setup.json` 与 `setup.log`。`waitForWorkspaceSetup` 轮询这个状态文件；没有准备命令时立即返回 `none`；运行准备命令的进程意外退出时报告失败。
- **接手已有目录**（`openWorkspace`）：直接返回这个目录的工作区 ID。
- 步骤 agent 在 worktree 目录中工作：引擎本来就把 `cwd` 设为工作区目录。dsh 插件按这个 `cwd` 创建子 agent，已在真实 dsh 上验证。

## 3. 服务管理（已实现）

- **范围**：服务属于某个工作区。这个工作区可以是需求自己的 worktree（`{ workspaceId }`），也可以是对话所在的目录（`{ agentId }`），后者的目录由运行时的 `agentDirectory` 给出（dsh 通过插件的 `session` 读到）。
- **跨进程**：服务与引擎分离运行（detached），记录写在 `<kitHome>/workspaces/<…>/services/<名称>.json`，内容是进程号、端口、命令、退出码，输出写在同目录的 `<名称>.log`。所以 `req try` 启动的服务，以后的 `req try --stop` 可以停掉。
- **启动**（`startServices`）：先停掉同名服务，保证运行的是当前代码；再分配端口、启动，然后等每个服务就绪或退出，最多等 `serviceReadySeconds`。返回值与 Paseo 一致：地址、端口、是否在运行、健康状态、退出码，以及输出的最后 40 行。
- **停止**：Windows 用 `taskkill /T /F` 结束整个进程树；其他系统向进程组发送 SIGTERM，5 秒后仍在则发 SIGKILL。服务以 detached 方式启动，所以自成一个进程组。
- **已知限制**：进程号可能被系统复用，所以停止前不能确认它还是原来的服务进程；绑定 `0.0.0.0` 的服务，空闲端口按 `127.0.0.1` 检查。

## 4. 本机调度（设计，未实现）

**什么时候需要**：平台和插件都没有定时任务时才需要。dsh 的定时消息来自插件，Paseo 有自己的定时任务，所以现在两个适配器都用不上它。第一个用户会是 M3 的无头 CLI 运行时。引擎里用到定时的地方有：预约启动（`launch.ts`）、守护检查（`main.ts`，`cronEvery`）、等待提醒和自动继续（`pipeline.ts`）、需求总览定时发送（`digest.ts`，`scheduleNewAgent`）。

**做法**：用一个本机常驻的调度进程，按需启动，没有任务时自己退出。

- **任务**：每个定时任务存成一个文件 `<kitHome>/schedules/<id>.json`，内容是一次性时间或 cron 表达式、时区、截止时间、目标和配置路径。目标分两种：发消息给某个对话（`scheduleMessage`），或启动新 agent（`scheduleNewAgent`）。ID 用 `local:<uuid>`；取消（`cancelSchedule`）就是删除这个文件。
- **调度进程**：`node engine/src/builtin/scheduler.mjs`，以 detached 方式运行，同一个安装目录只有一个实例：用 `<kitHome>/schedules/.lock` 记录进程号，锁里的进程不在了就接管。它每 30 秒检查一次到期的任务，到期后按任务里的配置创建运行时，调用 `notifyAgent` 或 `startSessionAgent`；一次性任务执行后删除，周期任务过了截止时间也删除。没有任务时退出。
- **按需拉起**：每次创建定时任务时，以及引擎的每个入口（启动、`doctor`、`req` 子命令）发现还有任务但调度进程不在时，都把它拉起来。这样不需要开机自启，也不用碰系统级的计划任务。
- **错过的时间点**（调度进程不在时到期的）：
  - 一次性任务在 6 小时内补发一次，与 Paseo 适配器设的有效期一致；超过 6 小时不再发，在日志里说明，并在下次 `doctor` 中提示。
  - 周期任务只补最近的一次。
- **可见性**：`doctor` 列出待执行的任务和调度进程的状态；能力表中 `scheduling` 的来源显示为"laoshi 内置"。

**放弃的做法**：
- 用系统的计划任务（cron、Windows 的 `schtasks`）：各系统差异大；内网机器的权限不确定；任务会留在 laoshi 之外，卸载、迁移时容易遗漏。
- 让引擎进程自己计时：预约启动和需求总览要在引擎退出之后才到点，引擎不在时没人发。

**待定**：
- 调度进程以谁的身份、带哪些环境变量运行。它继承的是最初拉起它的那个进程的环境；配置里引用的环境变量，比如凭据，执行任务时必须读得到。
- 机器休眠后醒来时，补发的规则沿用上面"错过的时间点"的做法。

实现时连同测试一起做。测试用一个可注入的时钟，覆盖一次性、cron、截止时间、补发、单实例和接管这几种情况。
