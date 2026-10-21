# 初始化与"自己长出来"：laoshi init

- 状态：提议，核心假设需要用内部 agent 平台验证
- 目标：新平台接入时，由内置 skill 借助 LLM 探测平台现状、生成适配、自检；使用者不必手写适配器。

## 1. 先把"长出来"限定清楚

"让核心能力自己长出来"如果理解成**每次运行时由模型现场决定怎么调用平台**，会和本项目最重要的目标冲突：流程可控、AI 和人都不即兴发挥。所以约束如下：

1. **只在安装时生成，运行时不生成。** 生成物是普通文件（适配器描述或代码），经人确认后**锁定**；运行时只执行锁定的版本。
2. **生成的是描述，不是自由代码（优先）。** 见 §3：先让模型填一份声明式的"适配器描述"，由通用解释器执行；描述表达不了时才允许生成代码，并要求更严格的审阅。
3. **探针是证据。** 能力有没有，不由模型说了算，由真实的探针测试结果决定。
4. **平台变了就失效。** 平台版本或 laoshi 版本变化时，锁定文件标记为过期，由 `doctor` 提示重新生成。

## 2. 流程

```text
detect → probe → generate → review → lock → verify
```

| 阶段 | 做什么 | 产出 |
| --- | --- | --- |
| detect | 识别平台：环境变量、已安装命令、skill 目录、配置文件；也可以由使用者指定 | 平台线索 |
| probe | 在临时目录里运行一组探针（见 [adapter-guide.md §5](adapter-guide.md)）：起子 agent、等待、追问、通知、打断、预约、工作区、服务…；每个探针记录命令、输出、通过与否 | 能力矩阵 + 证据 |
| generate | `laoshi-init` skill 让 LLM 阅读平台的命令行帮助/API 文档/探针输出，填写适配器描述（§3） | `adapters/generated/<id>/` |
| review | 展示：能力矩阵、生成物与参考适配器的差异、将要执行的命令列表；**使用者确认才继续** | 确认记录 |
| lock | 写 `laoshi.adapter.lock.json`：平台版本、laoshi 版本、生成物哈希、探针结果、确认人与时间 | 锁定文件 |
| verify | 跑一遍样例需求的 golden run（小需求，真实步骤）；通过才标记可用 | 报告 |

`laoshi doctor` 会重新计算生成物哈希并与锁定文件比较，不一致即报错（防止被改动或漂移）。

## 3. 声明式适配器描述

很多平台通过命令行或 HTTP 暴露能力。适配器描述把"能力 → 调用方式 → 如何解析输出"写成数据：

```yaml
id: internal-agent
compatibleWith: ">=2.3"
identifyOrigin:
  env: { sessionId: AGENT_SESSION_ID, cwd: AGENT_SESSION_CWD }
capabilities:
  startAgent:
    command: ["agentctl", "spawn", "--parent", "{parentId}", "--cwd", "{cwd}", "--title", "{title}", "--prompt-file", "{promptFile}"]
    parse: { agentId: "$.id" }
  wait:
    command: ["agentctl", "wait", "{agentId}", "--timeout", "{timeoutSec}"]
    parse: { status: "$.status", lastMessage: "$.last" }
  notifyAgent:
    command: ["agentctl", "send", "{agentId}", "--text-file", "{textFile}"]
  # 没有声明的能力 = 不支持
vocabulary:
  scheduleUi: null
  subagentList: "会话的子任务列表"
```

通用解释器（`adapters/generic/`）读取描述并实现 `AgentRuntime`：参数以数组传递、不经 shell，输出按声明的路径解析。以上字段是示意，**真实格式要在拿到内部平台的实际接口后定**。

好处：

- LLM 只填数据，生成物可以逐行审阅，错误是"填错"而不是"写了不安全的代码"。
- 弱模型（内网模型视觉和代码能力有限）也更容易做对，因为任务更窄。
- 同一个解释器可测试、可复用，探针测试对所有声明式适配器通用。

局限：平台能力需要多步协商、需要长连接（WebSocket 订阅）、或输出难以用路径解析时，描述表达不了，需要手写适配器（Paseo 适配器就是这种）。

## 4. 参考适配器的作用

- `adapters/paseo/`（手写，完整）：既是生产适配器，也是 generate 阶段的参考样本。
- `adapters/generic/` 的示例描述（至少一个无头 CLI 例子）：generate 阶段的模板，模型照例子改，而不是从空白开始。

## 5. 信任与安全

- 生成物是会在使用者权限下执行命令的东西，等同于代码，必须经 review 阶段人工确认。
- probe 和 verify 只在临时目录运行；探针里需要的平台操作（创建 agent、预约）有明确的清理步骤，并在报告里列出做了什么。
- 描述里的命令模板不得拼接 shell；占位符的值来自受控字段（agentId、路径、文本文件），不直接嵌入自由文本。
- `laoshi init` 不读取、不输出平台的凭据；需要凭据的平台由使用者通过环境变量提供（沿用 req-kit 的 `daemonPasswordEnv` 做法）。

## 6. 待定与风险

- **内部平台的真实接口形态未知**：声明式描述是否够用，要在拿到平台接口说明后才能判断。先做 `probe` 和描述解释器的最小版本，用内部平台跑一次。
- 生成阶段使用哪个模型：内网模型能力较弱时，需要更多模板与更强的校验（描述的 schema 校验 + 探针）；失败时给出明确的"请手写适配器"出口。
- 探针对用量的消耗和对平台的副作用，需要在内部平台上确认可接受。
- 锁定文件是否进仓库：倾向放机器配置目录而不是项目仓库（适配器是机器级，不是项目级）。
