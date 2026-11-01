@echo off
setlocal
chcp 65001 >nul
rem laoshi dsh 内网摸底包（Windows 启动脚本），说明见 README.md
rem   run.cmd --self-test     先自测：用模拟模型验证摸底包本身，约 3 分钟
rem   run.cmd                 正式运行：用 LAOSHI_PROBE_MODEL_* 指定的模型网关
rem 当前目录下没有 dsh 时会先安装；内网 npm 镜像用 LAOSHI_PROBE_NPM_REGISTRY 指定。

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 node。请先安装 Node.js（22.19 以上，推荐 24），并确认 node 在 PATH 中。
  exit /b 2
)
where git >nul 2>nul
if errorlevel 1 (
  echo 找不到 git。请先安装 Git for Windows，并确认 git 在 PATH 中。
  exit /b 2
)

if defined LAOSHI_PROBE_DSH goto run
if exist "node_modules\@deepseek-ai\dsh\package.json" goto run

echo 正在安装 @deepseek-ai/dsh@0.2.2-alpha.2（约 950 MB，首次需要几分钟）...
set "REGISTRY_ARG="
if defined LAOSHI_PROBE_NPM_REGISTRY set "REGISTRY_ARG=--registry=%LAOSHI_PROBE_NPM_REGISTRY%"
call npm install @deepseek-ai/dsh@0.2.2-alpha.2 --no-audit --no-fund --engine-strict=false %REGISTRY_ARG%
if errorlevel 1 (
  echo 安装 dsh 失败，请检查内网 npm 镜像（LAOSHI_PROBE_NPM_REGISTRY）。
  exit /b 2
)

:run
node "%~dp0run.mjs" %*
exit /b %errorlevel%
