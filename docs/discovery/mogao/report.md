# 摸高沙箱摸底报告（第一轮）

- 时间：2026-11-06
- 做法：在摸高的对话里运行 [probe.sh](probe.sh)，并按 [README](README.md) 做了存活测试；结论由使用者整理后发回。原始输出未入库。
- 用途：决定 laoshi 以哪种形态作为摸高上的"专家"参加数字工程师挑战赛（赛题：在平台中提交 skill 或专家，专家是多个 skill 的组合）。设计见 [mogao-expert](../../design/mogao-expert.md)。

## 结论

| 问题 | 结果 |
| --- | --- |
| 容器的寿命 | 每个会话新建一个容器（`/proc/uptime` 只有几分钟）。**每条命令执行完，沙箱实例就被回收**：两次存活测试里后台进程都只活了 10～20 秒 |
| 哪些目录持久 | `/data/workspace` 持久（标记文件、npm 安装结果、打包结果都在）；`/tmp`、`$HOME`（`/wls/ci/`）每次执行都重置 |
| 一次命令能跑多久 | 一次执行内可以跑长任务：前台约 60 秒后转为后台会话继续；同一次执行内可以用平台命令行 `aimax run` 起任务并轮询状态 |
| 跨对话、跨回合的后台进程 | **不行**。"后台常驻 + 之后再查状态"走不通 |
| 平台命令行 | `aimax`（有 `run` 子命令），用法待第二轮确认 |
| 平台环境变量（只记名字） | `AIMAX_SESSION_ID`、`AIMAX_USER_NAME`、`AIMAX_MODEL`、`AIMAX_VL_MODEL`、`AIMAX_LLM_API_KEY` |
| 工具链 | Node.js 23.11、npm 10.9、git 2.43、Python 3.12、Java、docker 19.03、curl、zip/unzip/tar；沙箱自带的工具较少，没有 mvn、gradle。**缺的工具可以装到 `/data/workspace` 下，不随沙箱销毁而丢失**（已确认 mvn 装在工作区可用） |
| 网络 | npm 走内网镜像，装包可行（`tsx@4` 2.6 秒、12 MB，可执行，结果持久在工作区）；公网全部不通（npm 官方源、GitHub、模型服务） |
| skill 的格式 | 业界通用的 `SKILL.md` 结构，只是目录是平台定制的 |
| skill 在哪里 | `/aimax/extensions/*/skills`（如 workflow-script、goals）；`/scenes/dev/…`、`/scenes/product/…`、`/scenes/test/…` 下有大量 `SKILL.md`（SDD 系列、BRD/PRD、测试用例与执行等）；内置 skill 在 `/aimax_pvc/skills/built-in/*`；`$HOME` 下没有 `.claude`、`.agents` 等目录 |

## 对形态的判断

- **形态甲（专家 + 常驻后台引擎）不可行**：后台进程活不过一次执行，`/tmp`、`$HOME` 也不持久。只有平台明确提供跨对话的常驻进程时才能重新考虑。
- **可行的是"每条命令内跑完"**：一次执行内可以跑长任务，也可以在同一次执行内用 `aimax run` 起任务并等它结束；状态只能写在 `/data/workspace`。
- **依赖可以在第一次使用时从内网镜像装**，装好的东西留在工作区。
- 结论倾向：形态乙（对话内编排；或"每次执行跑完一步"）或形态丙（纯 skill）。

## 还需要确认（第二轮，[probe2.sh](probe2.sh)）

1. `aimax run` 的用法：怎么传提示词（能否用文件）、工作目录、模型；是阻塞到结束还是立即返回；有没有查状态的命令；输出格式；HITL 怎么表现。
2. 对话里的 agent 有没有起子 agent 的工具。
3. 一次执行最长能跑多久（转为后台会话之后，对话会不会等它结束、有没有总时限）。
4. 内网镜像上能否装到 `@yiyi_zhang/laoshi`，装好后能否运行。
5. 专家怎么定义和提交：能否带附加文件（脚本、模板），评审在谁的沙箱里试用。
