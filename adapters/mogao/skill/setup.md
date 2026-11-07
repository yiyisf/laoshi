<!-- laoshi: the 摸高 sections of the entry skills (the expert). Each turn of a 摸高 chat gets a new machine; only /data/workspace lasts, so laoshi lives there and is installed on first use. -->
<!-- fragment: firstUse -->
## 摸高上第一次使用

laoshi 装在工作区（`/data/workspace/.laoshi`），每个对话轮次的机器都是新的，但工作区里的东西会保留，所以**一个工作区只需要安装一次**。执行本 skill 里的任何命令之前，先执行下面这条（工作区里已经是这个版本时立即结束；专家换了新版本时会自动换上）：

```bash
[ "$(node -p "require('{{REQ_KIT_ROOT}}/package.json').version" 2>/dev/null)" = "{{REQ_KIT_VERSION}}" ] || { npm install --prefix /data/workspace/.laoshi/npm --no-audit --no-fund @yiyi_zhang/laoshi@{{REQ_KIT_VERSION}} && node "{{REQ_KIT_ROOT}}/bin/req.mjs" install --platform mogao --home /data/workspace/.laoshi; }
```

第一次大约需要一分钟（从内网 npm 镜像安装）。失败时把输出告诉用户，请开发同事看一下，不要自己改安装目录。

本 skill 里写成 `req …` 或 `laoshi …` 的命令，在摸高上写成 `node "{{REQ_KIT_ROOT}}/bin/req.mjs" …`。
<!-- fragment: launchNote -->

**在摸高上不一样的地方：**
- "启动""继续""确认方案后继续""开始测试验证"这几条命令**不会一两秒就返回**：流水线就在这条命令里运行，进展会陆续出现在命令输出里，直到需要人决定（方案确认、业务问题、等待批准）或做完，命令才结束。这期间**不要结束这一轮对话**：命令转到后台后，持续查看它的输出，把进展用一句话转告用户，等命令结束再回复。对话结束时机器会被收回，流水线随之中断；下一轮用"继续"命令接着做，已经做完的步骤不会重做。
- 输出提示某个步骤**在等待批准**时：把要批准的操作原样告诉用户，问批准还是拒绝，然后结束这一轮。用户回答后执行 `node "{{REQ_KIT_ROOT}}/bin/req.mjs" permission <功能目录> approve`（拒绝用 `deny`，可以在后面写上理由），它会转达决定并接着运行，同样要等它结束。
- 没有定时任务：预约启动、定时提醒、自动继续都用不了。需要以后再做的事，告诉用户到时在对话里说"继续"。
<!-- fragment: toolsNote -->
- **摸高的沙箱自带的工具很少**（例如没有 mvn、gradle），机器每个对话轮次都是新的，只有工作区保留。项目要用、沙箱里没有的工具，装到 `/data/workspace/.laoshi/tools/<工具>`（例如解压 Maven 到 `/data/workspace/.laoshi/tools/maven`，本地仓库设为 `/data/workspace/.laoshi/tools/m2`），命令里写工具的完整路径（例如 `/data/workspace/.laoshi/tools/maven/bin/mvn -Dmaven.repo.local=/data/workspace/.laoshi/tools/m2 test`）；`verify.md` 和 `.laoshi/services.json` 里的命令也这样写，因为每次执行时 `PATH` 都会重置。
