<!-- laoshi: sections of the entry skills every platform gets unless its adapter's skill file has a block of the same name. -->
<!-- fragment: launchResult -->
启动命令检查条件后在后台运行，一两秒内返回：
- 输出"已在后台启动"：告诉用户开发已经开始。每个步骤会以"[功能目录名] 步骤名"出现在这个对话的子 agent 列表里，想看可以点开。
- 输出"未启动"：把原因告诉用户。spec 未确认 → 回到确认；同一目录已有流水线在运行 → 等它结束；工作目录不一致 → 到需求所在的项目中开对话；当前在默认分支 → 问用户是否改用"启动（自动新建工作区）"；其他原因（找不到程序、配置有误等）→ 请用户运行 `/laoshi-doctor` 或联系开发同事，并附上输出。
