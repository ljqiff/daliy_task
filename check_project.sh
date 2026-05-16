#!/bin/bash
# check_project.sh - 定时检查博大新元项目状态的包装脚本
# 使用方法:
#   ./check_project.sh              # 交互模式（有界面，手动登录）
#   ./check_project.sh --setup      # 首次设置（有界面，交互登录）
#   ./check_project.sh --headless   # 后台模式（定时任务用）

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 设置 Playwright Chromium 所需的库路径
export LD_LIBRARY_PATH="$HOME/lib/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"

# 运行检查脚本
node check_project.js "$@"
