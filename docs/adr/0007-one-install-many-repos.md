# 0007 一次安装，多库共用；库内只放专属配置

- 状态：提议（待摸底实验 A、实验 5 确认平台上的可行性）
- 日期：2026-10-28
- 关联：[ADR 0003](0003-generate-once-then-lock.md)、[ADR 0004](0004-external-contracts-stay-stable.md)、[ADR 0006](0006-deterministic-engine-platform-capabilities.md)

## 背景

laoshi 要服务多套代码库，**不能每个代码库安装一次**；代码库级专属配置除外。

试用平台（摸高）的约束：

- 沙箱只挂载使用者的工作区 `/data/workspace`（默认 4 GB，可扩容），工作区外的目录在下一次对话会被清理。`$HOME` 和 npm 全局目录不能当作持久位置。
- 工作区的 `repos/` 下同时放前端和多个后端微服务，一个需求经常涉及其中几个。
- 平台有**个人版和团队版**，使用方式基本一致，区别只是单人使用还是多人共用；团队版没有特殊的团队配置。

现有设计默认"机器级"就是 `~/.laoshi/` 加 npm 全局安装，在该平台上每次对话都会丢失。

## 决定

1. **安装单位是"安装根"，不是代码库。** 安装根由 `LAOSHI_HOME` 指定，本机默认 `~/.laoshi/`。laoshi 本体、skill、适配器与锁定文件、安装级配置、使用记录与索引都在安装根内。一个安装根服务所有代码库，代码库里不安装任何东西。
2. **安装根必须在持久位置。** 在摸高平台上放在工作区内（建议 `/data/workspace/.laoshi/`），本体用 `npm install --prefix <安装根>` 安装，不依赖 npm 全局目录和 `$HOME`。平台从哪里加载 skill 由适配器负责：能指向安装根时直接指向；不能时由适配器在会话开始时从安装根恢复。代码库内不放 skill 副本。
3. **代码库内只放专属配置和需求产出：**
   - `.laoshi.json`、`.laoshi/`（`project-notes.md`、`verify.md` 等）；
   - 平台要求放在代码库内的工作区配置（例如 Paseo 的 `paseo.json`），由对应适配器的文档写明；
   - 需求产出 `docs/features/<需求>/`（含 `.pipeline/state.json`）。

   `laoshi-setup` 不向代码库复制 skill、提示词、脚本或引擎代码。req-kit 写进代码库的模板脚本（`with-port.mjs`、`copy-local-files.mjs`）改为适配器资产，由代码库配置引用。
4. **配置两层：安装级 → 代码库级**，后者覆盖前者。不设团队层：团队版下安装级配置本身就是团队共享的。req-kit 1.x 的团队层配置继续读取，`laoshi migrate` 提示合并到安装级。
5. **个人版与团队版是同一套设计**，个人版就是只有一个使用者的团队版。
   - 共享：本体、适配器与锁定文件、安装级配置。
   - 按使用者区分：使用记录、通知对象、并发名额、需求发起人。使用者身份由适配器提供（平台环境变量等），取不到时用安装级配置里的名字或系统用户名。
   - 凭据只来自使用者自己的环境变量，不写入安装根（团队版下安装根是共享的）。
6. **每次运行都带代码库标识和使用者标识。** 引擎从当前目录向上找 git 根确定代码库，标识为代码库根目录路径加远程地址。使用记录、通知事件、`laoshi api` 输出新增 `repo`、`user` 字段；按 ADR 0004 只加不改，仍为 `schema: 1`。
7. **一次升级会影响所有代码库，所以：** 代码库配置可以声明最低版本（如 `"laoshi": ">=1.2"`），由 `doctor` 检查；升级前列出安装根下各代码库进行中的需求；读到旧版状态时迁移并保留 `.bak`。

## 不做

- 跨安装根的汇总与权限管理（多个团队各自一个安装根时的统一视图另行设计）。
- 代码库级安装 laoshi 的模式（例如作为代码库的 devDependency）。

## 待验证（见 [platform-discovery](../design/platform-discovery.md) 实验 A、实验 5）

1. 安装在工作区内的 laoshi，在下一次对话里能直接使用。
2. 平台能否从工作区内的目录加载 skill。
3. 团队版下成员是否共用同一个工作区、文件权限如何、能否在沙箱里取到当前使用者身份。
4. 安装根占用的空间（含 `node_modules`）在 4 GB 配额内可接受。

第 1、2 项任一为"否"，回到本 ADR 重新评估安装根的位置与 skill 的加载方式。

## 影响

- 解决计划待定项 4：锁定文件放安装根。
- [architecture](../design/architecture.md) §5、§6，[init-bootstrap](../design/init-bootstrap.md) §6，[platform-discovery](../design/platform-discovery.md)，[plan](../extraction/plan.md) 随本 ADR 更新。
- 后续：`contracts/usage-record.md`、`notifier-event.md`、`cli-json.md` 新增 `repo`、`user` 字段；`contracts/state.md` 增加发起人；[compat-migration](../design/compat-migration.md) 的路径对照改为以 `LAOSHI_HOME` 为准；`laoshi-setup` 按决定 3 改造。
