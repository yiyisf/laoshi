<!-- laoshi: the command-line adapter's sections of the entry skills. There is no platform: step agents are runs of claude / codex, nothing is sent back to the chat, and there is no scheduling. -->
<!-- fragment: launchNote -->

**用命令行 agent（Claude Code、Codex）运行时不一样的地方：**
- 步骤 agent 是在后台运行的 `claude -p` / `codex exec`，**不会**出现在这个对话的子 agent 列表里；流水线也**不会**把通知发进这个对话。启动后告诉用户：开发在后台进行，想知道进展时说"做到哪了"，你就运行状态命令（`status`）并转述。
- 需要人决定的地方（方案确认、业务问题）、流水线停下或做完，都只体现在状态命令的输出里（以及团队配置的外部通知，如 IM）。用户问进展时，先运行状态命令，再按上面"收到通知时"的同一套做法处理。
- 命令行的非交互模式不会停下来等待批准；某一步因为权限不够失败时，请用户检查安装级配置中这个角色的 `modeId`。
- 没有定时任务：预约启动、定时提醒、自动继续都用不了。需要以后再做的事，告诉用户到时说"继续"。
