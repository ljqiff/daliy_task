# Daliy Task - 日常任务仓库

## 项目：博大新元青年人才项目检查器

定时检查 [博大新元青年人才住宿保障申报平台](http://dxs.bdalife.cn:4443) 的项目状态，每日通知。

### 功能

1. 自动登录（手机号 + 图形验证码 OCR + 短信验证码）
2. 选择「就业青年人才」类型
3. 阅读申请指南后进入项目列表页
4. 检查各项目是否满员
5. 保存截图和结果
6. 每日定时运行

### 目录结构

```
daliy_task/
├── README.md
├── check_project.js      # 主脚本
├── check_project.sh      # 启动包装脚本
├── config.json           # 配置文件（手机号等）
├── package.json
├── .auth_state.json      # 登录会话（自动保存）
├── project_status.json   # 最新检查结果
├── notification.txt      # 最新通知消息
├── cron_output.json      # 定时任务输出
├── screenshots/          # 截图目录
└── node_modules/         # 依赖
```

### 使用方式

#### 首次设置（需要交互）
```bash
./check_project.sh --setup
```
交互流程：
1. 输入手机号
2. 输入图形验证码
3. 输入短信验证码
4. 自动保存登录状态

#### 定时检查（后台模式）
```bash
./check_project.sh --headless
```

#### 设置每日定时任务（cron）
```bash
# 每天早上 9:00 检查
crontab -e
# 添加：
0 9 * * * /home/leo/code/daliy_task/check_project.sh --headless >> /home/leo/code/daliy_task/cron.log 2>&1
```

### 依赖

- Node.js >= 18
- Playwright (Chromium)
- tesseract.js (图形验证码 OCR)

### 环境变量

```bash
export LD_LIBRARY_PATH=$HOME/lib/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

---

Created by 小旗飞飞 🚩
