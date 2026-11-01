# 从 req-kit 移植的记录

laoshi 的核心来自 [paseo-req-kit](https://github.com/yiyisf/paseo-req-kit)（req-kit）。抽取期间 req-kit 1.x 只修缺陷（[ADR 0001](adr/0001-new-repo-core-and-adapters.md)），严重缺陷的修复要移植到 laoshi，并登记在本文末尾。

## M1 导入（2026-11-01）

- 来源：`yiyisf/paseo-req-kit` `a16e1e2`（1.15.0）。[计划](extraction/plan.md)和[资产清单](extraction/asset-inventory.md)写的是 1.13.0；导入时 req-kit 已到 1.15.0，所以按 1.15.0 导入，基线也按 1.15.0 记录。
- 提交：`M1（1/2）` 原样导入；`M1（2/2）` 把 Paseo 实现移到 `adapters/paseo/`，并按配置选择平台适配器。

### 路径对照

除下表外，导入的文件路径和文件名与 req-kit 相同，req-kit 的补丁一般可以直接应用。

| req-kit | laoshi |
| --- | --- |
| `engine/src/paseo-runtime.ts` | `adapters/paseo/paseo-runtime.ts` |
| `engine/src/paseo-profiles.ts` | `adapters/paseo/paseo-profiles.ts` |
| `engine/src/paseo-json.ts` | `adapters/paseo/paseo-json.ts` |
| `engine/src/daemon-check.ts` | `adapters/paseo/daemon-check.ts` |
| `engine/src/daemon-version.ts` | `adapters/paseo/daemon-version.ts` |
| `engine/test/paseo-json.test.ts` | `adapters/paseo/test/paseo-json.test.ts` |
| `engine/test/paseo-runtime.test.ts` | `adapters/paseo/test/paseo-runtime.test.ts` |

移植涉及这几个文件的补丁时：改文件路径；补丁里的 `./config.js` 等核心模块，在适配器里写作 `../../engine/src/config.js`；核心里引用这几个文件写作 `../../adapters/paseo/<文件>.js`。

### 导入了什么

`engine/`（src、prompts、test）、`skills/`、`principles/`、`notifiers/`、`evals/`、`design/`、`scripts/tokens-build.mjs`、`bin/`（`req.mjs`、`start-pipeline`、`start-pipeline.mjs`、`locate.mjs`、`req-doctor.mjs`）、`test/`（`checklist`、`code-review`、`review`、`skills`、`ui-check`）、`config.example.json`、`tsconfig.json`、`.gitattributes`；`contracts/` 更新到 1.15.0（`agent-runtime.md` 是 laoshi 自己的）。

### 留在 req-kit、M7 再处理的

分发层与 `paseo-req-kit` 这个 npm 包名、`~/.req-kit` 安装布局绑在一起，laoshi 的安装方式要按 [ADR 0007](adr/0007-one-install-many-repos.md) 重新设计，所以没有导入：

| 内容 | req-kit 中的位置 |
| --- | --- |
| 安装、升级、一键安装 | `install.mjs`、`install.sh`、`install.ps1`、`bin/bootstrap.mjs` |
| 文档站与 `req docs` | `site/`、`bin/req-docs.mjs`、`docs/guide/` |
| Paseo 插件界面与 `req plugin` | `paseo-plugin/`、`bin/req-plugin.mjs`（属于 Paseo 适配器，届时放到 `adapters/paseo/`） |
| 发布 | `scripts/release-media.mjs`、`.github/workflows/release.yml`、`CHANGELOG.md` |
| req-kit 的设计决定 | `docs/adr/`（0001～0033）。代码注释里的"ADR 00xx"指的是 req-kit 的 ADR，不是 laoshi 的 |
| 旧版本 | `legacy/` |

由此带来的限制：

- `req install`、`upgrade`、`setup`、`use`、`versions`、`check`、`configure`、`docs`、`plugin` 这几个子命令依赖上表的文件，在 laoshi 中不可用。配置向导可以直接运行 `npx tsx engine/src/configure.ts --config <配置文件>`。
- `req doctor` 的"安装"一节在没有安装器时跳过。
- 命令输出和提示里仍然写 req-kit、Paseo：改名和平台词汇表属于 M2（[ADR 0005](adr/0005-skill-names.md)、[平台词汇表](design/platform-vocabulary.md)）。

### 导入时的改动

为了让 laoshi 单独通过测试，对导入的文件只做了这些改动：

1. `engine/test/design.test.ts`：检查 Paseo 插件、文档站、发布素材的三项测试，在对应目录不存在时跳过。
2. `scripts/tokens-build.mjs`：只生成和检查存在的目录（`paseo-plugin/`、`site/` 不在时跳过）。
3. `engine/src/doctor.ts`：没有安装器时跳过安装检查。
4. Paseo 实现的移动和 import 路径（见上）。
5. `engine/src/config.ts` 新增 `platform.adapter`（默认 `"paseo"`），`engine/src/runtime-loader.ts` 按它选择适配器；新增 `engine/test/runtime-loader.test.ts`。
6. `package.json`：包名 `laoshi`，版本 `0.1.0-dev`，`private: true`（M7 前不发布）；`npm test` 和 `tsconfig.json` 纳入 `adapters/`。

### 验证

Node 22.22，Linux。

| | typecheck | `npm test` | `eval:self-check` |
| --- | --- | --- | --- |
| req-kit 1.15.0（`a16e1e2`） | 通过 | 244 项：242 通过、2 跳过、0 失败（约 7.4 分钟） | 4 个用例全部通过 |
| 其中留在 req-kit 的分发层测试（install、install-sh、plugin、req-docs） | — | 33 项：33 通过 | — |
| laoshi，原样导入后 | 通过 | 211 项：206 通过、5 跳过、0 失败 | — |
| laoshi，M1 完成后 | 通过 | 213 项：208 通过、5 跳过、0 失败 | 4 个用例全部通过，结果表与 req-kit 逐行一致 |

- 211 = 244 − 33。跳过的 5 项中，2 项与基线相同（本机没有浏览器），3 项是导入时改动 1 的三项检查。
- M1 完成后多出的 2 项是新增的 `runtime-loader.test.ts`。

## 导入之后对核心文件的改动

移植 req-kit 的补丁时，以下 laoshi 自己的改动要一并保留：

| 文件 | 改动 | 来由 |
| --- | --- | --- |
| `engine/src/cli-args.ts` | 没有 `PASEO_AGENT_ID` 时，从 `DSH_SESSION_ID` 识别发起的对话 | M4b dsh 原型 |
| `engine/src/review.ts`、`api.ts`、`code-review.ts`、`eval.ts` | 为子进程清理 Paseo 变量时，同时清理 `DSH_SESSION_ID` | M4b dsh 原型 |
| `engine/src/runtime-loader.ts` | 适配器表增加 `dsh` | M4b dsh 原型 |

## 移植登记

导入之后，req-kit 中需要移植到 laoshi 的修复登记在这里。

| req-kit 提交 | 内容 | laoshi 提交 | 备注 |
| --- | --- | --- | --- |
| | | | |
