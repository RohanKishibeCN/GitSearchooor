# Web3 Secret Bot 操作手册（VPS）

本文档面向在 VPS 上运行 GitSearchooor 的常见操作：部署、参数配置、状态检查、日志查看、排障与升级。

推荐项目目录：

- 项目：`/root/seed/GitSearchooor`
- 环境：`/root/seed/GitSearchooor/.env`
- 状态：`/root/seed/GitSearchooor/.data/`

## 0. 安全要求（必须先看）

- Notion integration token / GitHub token 只能放在 VPS 的 `.env`，不要粘贴到聊天、不要写入仓库、不要出现在日志里
- 如果 token 已经暴露，立即 revoke 并重新生成
- `.env` 权限建议为 600

## 1. 依赖安装

必须依赖：

- Python 3
- GitHub CLI：`gh`
- Notion CLI：`ntn`
- systemd（用于 timer）

验证：

```bash
python3 --version
gh --version
ntn --help
```

## 2. 拉取代码与目录准备

```bash
cd /root/seed
git clone https://github.com/RohanKishibeCN/GitSearchooor.git
cd /root/seed/GitSearchooor

mkdir -p /root/seed/GitSearchooor/.data
chmod 700 /root/seed/GitSearchooor/.data
```

## 3. Notion 准备

1. 在 Notion 新建一个 Page
2. 在该 Page 中新建一个 Database（表格）
3. 按项目约定创建字段（见下方“字段与映射”）
4. Share 该 Page/Database 给你的 Notion integration（否则写入会失败）

## 4. 配置（.env）

在项目根目录创建：

- `/root/seed/GitSearchooor/.env`

建议权限：

```bash
chmod 600 /root/seed/GitSearchooor/.env
```

### 4.1 必填项

```bash
GH_TOKEN=ghp_***
NOTION_API_TOKEN=ntn_***
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4.2 状态文件（放项目目录）

```bash
STATE_DB_PATH=/root/seed/GitSearchooor/.data/state.db
DEADLETTER_PATH=/root/seed/GitSearchooor/.data/deadletter.jsonl
```

### 4.3 扫描策略（策略 B：时间窗口）

- `REPO_PUSHED_DAYS=7` 表示只扫描最近 7 天内 pushed 的仓库

```bash
REPO_PUSHED_DAYS=7
GH_REPO_QUERY="web3 OR crypto OR x402 OR stablecoin OR coin archived:false fork:false is:public"
REPOS_PER_RUN=30
PER_REPO_CODE_HITS=10
LEAK_TERMS="seed phrase,seedphrase,mnemonic,private key,secret key,xprv,solana secret key"
```

注意：

- 有空格的值建议用双引号包起来（如 `LEAK_TERMS`、`GH_REPO_QUERY`）
- 想降低 GitHub 风控风险：优先减小 `REPOS_PER_RUN`、`PER_REPO_CODE_HITS`，再降低频率

### 4.4 速率与退避

```bash
MAX_CALLS_PER_MINUTE=40
MIN_INTERVAL_SEC=1.2
JITTER_SEC=0.8
BACKOFF_BASE_SEC=2
BACKOFF_MAX_SEC=120
BACKOFF_MAX_RETRIES=5
```

### 4.5 Notion 字段与映射（单表）

Notion Database 字段（你已创建）：

- Title（title，列名为 `Title`）
- Repo URL（url）
- File URL（url）
- File Path（text）
- Term（multi_select）
- Ecosystem（select：ethereum / solana / both / unknown）
- Snippet (Masked)（text）
- Blob SHA（text）
- Dedup Key（text）
- First Seen（date）
- Last Seen（date）
- Hit Count（number）
- Status（select：待复核 / 已确认 / 误报 / 已处理）
- Notes（text，可选）
- Tags（multi_select，可选）

映射配置（列名必须与 Notion 中一致）：

```bash
NOTION_DEFAULT_STATUS=待复核
NOTION_PROP_TITLE=Title
NOTION_PROP_REPO_URL="Repo URL"
NOTION_PROP_FILE_URL="File URL"
NOTION_PROP_FILE_PATH="File Path"
NOTION_PROP_TERM=Term
NOTION_PROP_ECOSYSTEM=Ecosystem
NOTION_PROP_SNIPPET="Snippet (Masked)"
NOTION_PROP_BLOB_SHA="Blob SHA"
NOTION_PROP_DEDUP_KEY="Dedup Key"
NOTION_PROP_FIRST_SEEN="First Seen"
NOTION_PROP_LAST_SEEN="Last Seen"
NOTION_PROP_HIT_COUNT="Hit Count"
NOTION_PROP_STATUS=Status
NOTION_PROP_NOTES=Notes
NOTION_PROP_TAGS=Tags
```

## 5. 手动运行（建议先 dry-run）

进入项目目录：

```bash
cd /root/seed/GitSearchooor
```

确认 `.env` 生效（不触发扫描）：

```bash
python3 -m web3_secret_bot.cli print-config
```

初始化状态库：

```bash
python3 -m web3_secret_bot.cli init-db
```

Dry-run（不写 Notion）：

```bash
python3 -m web3_secret_bot.cli run --dry-run
```

真实写入：

```bash
python3 -m web3_secret_bot.cli run
```

验证 upsert：

- 第一次 run：Notion 应新增行
- 第二次 run：相同命中不新增行，而是更新同一行的 `Last Seen/Hit Count`

## 6. systemd 部署（定时运行）

### 6.1 安装 service/timer

```bash
cp /root/seed/GitSearchooor/deploy/systemd/web3-secret-bot.service /etc/systemd/system/
cp /root/seed/GitSearchooor/deploy/systemd/web3-secret-bot.timer /etc/systemd/system/
systemctl daemon-reload
```

启用并启动 timer：

```bash
systemctl enable --now web3-secret-bot.timer
```

### 6.2 常用 systemd 操作

查看 timer 状态与下次运行：

```bash
systemctl status web3-secret-bot.timer
systemctl list-timers --all | grep web3-secret-bot
```

手动触发一次（不修改频率）：

```bash
systemctl start web3-secret-bot.service
```

停用：

```bash
systemctl disable --now web3-secret-bot.timer
```

### 6.3 修改运行频率

编辑 `/etc/systemd/system/web3-secret-bot.timer`：

- `OnUnitActiveSec=6h`：每 6 小时
- `RandomizedDelaySec=10min`：随机延迟，降低定点触发风险

修改后：

```bash
systemctl daemon-reload
systemctl restart web3-secret-bot.timer
```

## 7. 状态检查

### 7.1 查看状态文件

```bash
ls -lh /root/seed/GitSearchooor/.data/
```

### 7.2 查看 SQLite 内容（可选）

需要系统安装 `sqlite3` 才能执行：

```bash
sqlite3 /root/seed/GitSearchooor/.data/state.db "select count(1) from hits;"
sqlite3 /root/seed/GitSearchooor/.data/state.db "select kind, count(1) from events group by kind order by count(1) desc;"
sqlite3 /root/seed/GitSearchooor/.data/state.db "select repo, file_path, hit_count, last_seen from hits order by last_seen desc limit 20;"
```

### 7.3 deadletter（Notion 写入失败）

```bash
tail -n 50 /root/seed/GitSearchooor/.data/deadletter.jsonl
```

## 8. 日志查看

systemd 日志：

```bash
journalctl -u web3-secret-bot.service -n 200 --no-pager
journalctl -u web3-secret-bot.service -f
```

## 9. 常见故障排查

### 9.1 Notion 写入失败（403/400）

- 确认 Notion database 已 share 给 integration
- 检查 `.env` 的 `NOTION_API_TOKEN/NOTION_DATABASE_ID`
- 检查字段映射列名是否与 Notion 完全一致（包含大小写与空格）
- 失败 payload 会落到 `DEADLETTER_PATH`

### 9.2 GitHub 403/429 或 rate limit

- 降低 `REPOS_PER_RUN`、`PER_REPO_CODE_HITS`、`MAX_CALLS_PER_MINUTE`
- 提高 `MIN_INTERVAL_SEC`
- 延长 systemd timer 频率（例如 6h → 12h）

### 9.3 `.env` 未生效

- 确认 systemd service 的 `WorkingDirectory=/root/seed/GitSearchooor`
- 确认 `EnvironmentFile=-/root/seed/GitSearchooor/.env`
- 手动运行时确保在项目目录执行，或显式传参：

```bash
python3 -m web3_secret_bot.cli --env-file /root/seed/GitSearchooor/.env print-config
```

## 10. 升级与回滚

升级：

```bash
cd /root/seed/GitSearchooor
git pull --ff-only
systemctl restart web3-secret-bot.timer
```

回滚（示例：回到某个 commit）：

```bash
cd /root/seed/GitSearchooor
git checkout <commit-sha>
systemctl start web3-secret-bot.service
```
