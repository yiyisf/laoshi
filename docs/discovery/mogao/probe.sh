#!/usr/bin/env bash
# laoshi 摸高沙箱摸底：自动收集环境信息，结果打包成一个 .tar.gz，脱敏后再分享。
#
#   bash probe.sh [平台命令行的名字]        第一次：收集信息，并在后台起一个"存活测试"进程
#   bash probe.sh --check                   之后（新对话里，隔 5 分钟和 30 分钟各一次）：看哪些东西还在
#
# 只读为主：只在 $PROBE_DIR（默认 /data/workspace/laoshi-probe）、/tmp、$HOME 下各写一个小标记文件，
# 在 $PROBE_DIR 下装一个 npm 小包测试安装。用完删除：rm -rf "$PROBE_DIR" /tmp/laoshi-probe-mark ~/.laoshi-probe-mark
set -u
WS="${PROBE_WS:-/data/workspace}"
[ -d "$WS" ] || WS="$PWD"
PROBE_DIR="${PROBE_DIR:-$WS/laoshi-probe}"
mkdir -p "$PROBE_DIR"
OUT="$PROBE_DIR/out"
mkdir -p "$OUT"

# 脱敏：形如 token=…、key: …、Bearer …、URL 中的用户名密码，一律替换。
redact() {
  sed -E \
    -e 's#(https?://)[^/@ ]+:[^/@ ]+@#\1***:***@#g' \
    -e 's#([Bb]earer )[A-Za-z0-9._~+/=-]+#\1***#g' \
    -e 's#((token|secret|password|passwd|pwd|apikey|api_key|auth|credential|cookie|session_key)[A-Za-z_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?)[^"'"'"'[:space:],;]+#\1***#Ig' \
    -e 's#(sk-|ghp_|gho_|xox[bp]-)[A-Za-z0-9_-]{8,}#\1***#g'
}
# 运行一条命令，把命令行、输出、退出码记到 $OUT/<名字>.txt
rec() {
  local name="$1"; shift
  { echo "\$ $*"; ( "$@" ) 2>&1 | head -n 400; echo "[exit ${PIPESTATUS[0]}]"; } | redact > "$OUT/$name.txt"
}
recsh() {
  local name="$1"; shift
  { echo "\$ $1"; bash -c "$1" 2>&1 | head -n 400; echo "[exit ${PIPESTATUS[0]}]"; } | redact > "$OUT/$name.txt"
}

if [ "${1:-}" = "--check" ]; then
  N="check-$(date +%H%M%S)"
  {
    echo "检查时间：$(date -Is)"
    for f in "$PROBE_DIR/mark" /tmp/laoshi-probe-mark "$HOME/.laoshi-probe-mark"; do
      if [ -f "$f" ]; then echo "还在：$f（$(cat "$f")）"; else echo "不在了：$f"; fi
    done
    if [ -f "$PROBE_DIR/bg.pid" ] && kill -0 "$(cat "$PROBE_DIR/bg.pid")" 2>/dev/null; then echo "后台进程还活着（pid $(cat "$PROBE_DIR/bg.pid")）"; else echo "后台进程不在了"; fi
    echo "后台日志最后一行：$(tail -n 1 "$PROBE_DIR/bg.log" 2>/dev/null || echo 无)"
    echo "后台日志行数：$(wc -l < "$PROBE_DIR/bg.log" 2>/dev/null || echo 0)（每 10 秒一行）"
    if [ -x "$PROBE_DIR/npmtest/node_modules/.bin/tsx" ]; then echo "工作区里装的 tsx 还能用：$("$PROBE_DIR/npmtest/node_modules/.bin/tsx" --version 2>&1 | head -1)"; else echo "工作区里装的 tsx 不在或不能执行"; fi
    echo "当前会话的进程链："; p=$$; for _ in 1 2 3 4 5 6 7 8; do ps -o pid=,ppid=,args= -p "$p" 2>/dev/null | cut -c1-200; p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); [ -z "$p" ] || [ "$p" = 0 ] && break; done
  } 2>&1 | redact | tee "$OUT/$N.txt"
  tar -czf "$PROBE_DIR/laoshi-probe-out.tar.gz" -C "$PROBE_DIR" out && echo "已更新 $PROBE_DIR/laoshi-probe-out.tar.gz"
  exit 0
fi

CLI="${1:-}"
echo "收集中，结果在 $OUT ……"

# 1. 系统与工具
recsh 01-system 'uname -a; cat /etc/os-release 2>/dev/null | head -5; echo "whoami=$(whoami) id=$(id)"; echo "PWD=$PWD HOME=$HOME SHELL=${SHELL:-}"; nproc 2>/dev/null; free -h 2>/dev/null'
recsh 02-disk "df -h \"$WS\" /tmp \"\$HOME\" 2>&1; du -sh \"$WS\" 2>/dev/null"
recsh 03-tools 'for c in node npm npx git bash sh python3 java mvn gradle docker curl zip unzip tar; do printf "%-8s " "$c"; if command -v "$c" >/dev/null; then echo "$(command -v "$c")  $( ("$c" --version || "$c" -version) 2>&1 | head -1)"; else echo "无"; fi; done'
recsh 04-npm 'npm config get registry; npm config get prefix; ls -ld "$(npm config get prefix)" 2>&1; npm view tsx version 2>&1 | tail -2'
# 2. 环境变量：只记名字，不记值（平台给会话的 ID、工作目录等通常在这里）
recsh 05-env-names 'env | cut -d= -f1 | sort'
recsh 06-env-platformish 'env | cut -d= -f1 | grep -iE "agent|session|task|workspace|skill|expert|chat|user|tenant|project|model|llm|mcp|hitl|plugin|sandbox" | sort'
# 3. 当前会话是怎么跑起来的：进程链和进程列表（看出 agent 运行时是什么）
recsh 07-process-chain 'p=$$; for i in 1 2 3 4 5 6 7 8 9 10; do ps -o pid=,ppid=,user=,args= -p "$p" 2>/dev/null | cut -c1-300; p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); [ -z "$p" ] || [ "$p" = 0 ] && break; done'
recsh 08-processes 'ps -eo pid,ppid,user,etime,args 2>/dev/null | cut -c1-300 | head -80'
# 4. skill 和 agent 配置在哪里：找 SKILL.md、agents/experts 目录、常见 agent 的配置目录
recsh 09-skill-files 'find / -xdev \( -path /proc -o -path /sys -o -path "*/node_modules" \) -prune -o \( -name SKILL.md -o -name "*.skill.md" -o -name "skill.json" -o -name "skill.yaml" -o -name "expert*.json" -o -name "expert*.yaml" -o -name AGENTS.md -o -name CLAUDE.md \) -print 2>/dev/null | head -100'
recsh 10-agent-dirs 'for d in "$HOME/.claude" "$HOME/.agents" "$HOME/.codex" "$HOME/.config/opencode" "$HOME/.opencode" "$HOME/.dsh" "$HOME/.config" "'"$WS"'"; do echo "== $d"; ls -la "$d" 2>&1 | head -40; done'
recsh 11-skill-dirs 'find / -xdev \( -path /proc -o -path /sys -o -path "*/node_modules" \) -prune -o -type d \( -name skills -o -name experts -o -name agents -o -name prompts \) -print 2>/dev/null | head -60'
# 5. 网络：npm 源能否安装；能否访问外网（只看能不能连上，不下载内容）
recsh 12-npm-install "mkdir -p \"$PROBE_DIR/npmtest\" && cd \"$PROBE_DIR/npmtest\" && time npm install --prefix . --no-audit --no-fund tsx@4 2>&1 | tail -3; ls node_modules/.bin 2>&1 | head; du -sh . 2>/dev/null"
recsh 13-network 'for u in https://registry.npmjs.org/ https://github.com/ https://api.anthropic.com/ https://api.deepseek.com/; do printf "%-32s " "$u"; curl -s -o /dev/null -m 8 -w "%{http_code}\n" "$u" 2>&1 || echo 失败; done'
# 6. 平台命令行（如果给了名字）
if [ -n "$CLI" ]; then
  rec 20-cli-which bash -c "command -v $CLI; ls -la \$(command -v $CLI) 2>&1"
  rec 21-cli-version "$CLI" --version
  rec 22-cli-help "$CLI" --help
  # 帮助里列出的子命令，各取一份 --help（最多 20 个）
  for sub in $(grep -oE '^\s{2,}[a-z][a-z0-9-]+' "$OUT/22-cli-help.txt" | awk '{print $1}' | sort -u | head -20); do
    rec "23-cli-help-$sub" "$CLI" "$sub" --help
  done
else
  echo "（没有给平台命令行的名字，跳过第 6 部分。知道名字后再运行：bash probe.sh <名字>）" > "$OUT/20-cli-skipped.txt"
fi

# 7. 存活测试：标记文件 + 每 10 秒写一行的后台进程；之后用 --check 看
date -Is > "$PROBE_DIR/mark"; date -Is > /tmp/laoshi-probe-mark; date -Is > "$HOME/.laoshi-probe-mark"
nohup bash -c "while true; do date -Is >> \"$PROBE_DIR/bg.log\"; sleep 10; done" >/dev/null 2>&1 &
echo $! > "$PROBE_DIR/bg.pid"
echo "后台进程 pid $(cat "$PROBE_DIR/bg.pid")，开始于 $(date -Is)" > "$OUT/30-background-started.txt"

tar -czf "$PROBE_DIR/laoshi-probe-out.tar.gz" -C "$PROBE_DIR" out
echo
echo "完成：$PROBE_DIR/laoshi-probe-out.tar.gz"
echo "1. 先打开 $OUT 下的文件看一遍，确认没有不能外发的内容（脚本已经尽量脱敏）。"
echo "2. 结束这次对话，5 分钟后和 30 分钟后各在新对话里运行：bash $0 --check"
echo "3. 测试结束后清理：kill \$(cat $PROBE_DIR/bg.pid); rm -rf $PROBE_DIR /tmp/laoshi-probe-mark ~/.laoshi-probe-mark"
