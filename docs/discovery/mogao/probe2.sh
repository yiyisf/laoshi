#!/usr/bin/env bash
# laoshi 摸高沙箱摸底第二轮：平台命令行 aimax 的用法，以及内网 npm 镜像上的 laoshi。
#
#   bash probe2.sh            结果在 /data/workspace/laoshi-probe/out2，打包成 laoshi-probe-out2.tar.gz
#
# 只读为主：只在 /data/workspace/laoshi-probe 下写结果，并把 laoshi 试装到 /data/workspace/laoshi-probe/try。
# 用完删除：rm -rf /data/workspace/laoshi-probe
set -u
WS="${PROBE_WS:-/data/workspace}"
[ -d "$WS" ] || WS="$PWD"
PROBE_DIR="$WS/laoshi-probe"
OUT="$PROBE_DIR/out2"
mkdir -p "$OUT"
CLI="${1:-aimax}"

redact() {
  sed -E \
    -e 's#(https?://)[^/@ ]+:[^/@ ]+@#\1***:***@#g' \
    -e 's#([Bb]earer )[A-Za-z0-9._~+/=-]+#\1***#g' \
    -e 's#((token|secret|password|passwd|pwd|apikey|api_key|auth|credential|cookie|session_key)[A-Za-z_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?)[^"'"'"'[:space:],;]+#\1***#Ig' \
    -e 's#(sk-|ghp_|gho_|xox[bp]-)[A-Za-z0-9_-]{8,}#\1***#g'
}
recsh() {
  local name="$1"; shift
  { echo "\$ $1"; timeout 120 bash -c "$1" 2>&1 | head -n 300; echo "[exit ${PIPESTATUS[0]}]"; } | redact > "$OUT/$name.txt"
}

echo "收集中，结果在 $OUT ……"

# 1. 平台命令行：位置、版本、帮助，以及每个子命令（和子命令的子命令）的帮助
recsh 01-cli-which "command -v $CLI; ls -la \"\$(command -v $CLI)\"; file -L \"\$(command -v $CLI)\" 2>/dev/null; head -c 400 \"\$(command -v $CLI)\" 2>/dev/null | strings | head -5"
recsh 02-cli-version "$CLI --version; $CLI version"
recsh 03-cli-help "$CLI --help; echo ----; $CLI help"
subs=$(grep -hoE '^\s{1,6}[a-z][a-z0-9:_-]+' "$OUT/03-cli-help.txt" | awk '{print $1}' | sort -u | grep -vE '^(help|version)$' | head -25)
for sub in $subs; do
  recsh "04-help-$sub" "$CLI $sub --help"
  for sub2 in $(grep -hoE '^\s{1,6}[a-z][a-z0-9:_-]+' "$OUT/04-help-$sub.txt" | awk '{print $1}' | sort -u | grep -vE "^(help|version|$sub)$" | head -10); do
    recsh "05-help-$sub-$sub2" "$CLI $sub $sub2 --help"
  done
done
# 平台给会话的环境变量（只记名字）和 aimax 自己的配置目录
recsh 06-env-names 'env | cut -d= -f1 | grep -iE "aimax|session|task|agent|workspace|skill|expert|model" | sort'
recsh 07-cli-config 'for d in /aimax /aimax/extensions /aimax_pvc /aimax_pvc/skills "$HOME/.aimax" /etc/aimax; do echo "== $d"; ls -la "$d" 2>&1 | head -30; done'
recsh 08-extension-skills 'for f in /aimax/extensions/*/skills/*/SKILL.md; do echo "== $f"; head -20 "$f"; done 2>&1 | head -200'

# 2. 内网 npm 镜像上的 laoshi：能否查到、能否装进工作区并运行
recsh 10-laoshi-view 'npm view @yiyi_zhang/laoshi version dist-tags --json 2>&1 | head -20'
recsh 11-laoshi-install "rm -rf \"$PROBE_DIR/try\" && mkdir -p \"$PROBE_DIR/try\" && cd \"$PROBE_DIR/try\" && time npm install --prefix . --no-audit --no-fund @yiyi_zhang/laoshi@latest 2>&1 | tail -5; du -sh . 2>/dev/null"
recsh 12-laoshi-run "cd \"$PROBE_DIR/try\" && node node_modules/@yiyi_zhang/laoshi/bin/req.mjs version && node node_modules/@yiyi_zhang/laoshi/bin/req.mjs help | head -12"
recsh 13-laoshi-engine "mkdir -p \"$PROBE_DIR/repo\" && cd \"$PROBE_DIR/repo\" && git init -q 2>/dev/null; LAOSHI_HOME=\"$PROBE_DIR/home\" node \"$PROBE_DIR/try/node_modules/@yiyi_zhang/laoshi/bin/req.mjs\" list"

# 3. 一次命令能跑多久：这里只记开始和结束时间（由对话决定是否等完）
recsh 20-duration "date -Is; sleep 75; date -Is"

tar -czf "$PROBE_DIR/laoshi-probe-out2.tar.gz" -C "$PROBE_DIR" out2
echo
echo "完成：$PROBE_DIR/laoshi-probe-out2.tar.gz"
echo "先打开 $OUT 下的文件过一遍，确认没有不能外发的内容，再发回来。"
