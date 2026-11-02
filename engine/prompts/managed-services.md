# {{platform.managedServices}}

这个项目在 `{{platform.servicesFile}}` 中定义了服务，流水线已经在本步骤开始前，通过 {{platform.servicesBy}} 带着当前的代码把它们启动好了（见 `<pipeline-context>` 中"{{platform.managedServices}}"几行）。{{platform.servicesBy}} 为每个工作区分配独立的端口，同时进行的其他需求不会和你冲突。

- **直接使用给出的地址**访问服务，不要再自己启动同一个服务的另一份（会占用端口、读到旧代码）。
- 服务**没有启动成功**或**健康检查没有通过**时，先读给出的输出文件找原因。原因在这次的代码改动里的，按本步骤的要求处理；属于环境问题的，如实记录。需要时可以按项目的验证方法自己另起一份（换一个空闲端口），用完关掉。
- 你修改了代码、而服务不会自动加载修改时：{{platform.servicesRestart}}
- **不需要关闭** {{platform.managedServices}}，流水线会在验证结束后停止它们。
- 在产物中写启动方法时，写 `{{platform.servicesFile}}` 中的脚本名和对应的命令，并注明"由 {{platform.servicesBy}} 管理"。
