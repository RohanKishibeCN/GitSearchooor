# GitSearchooor

VPS 上定时扫描 GitHub Public 仓库中的 Web3 泄露线索（助记词/私钥/secret 等），将命中结果脱敏后写入 Notion Database，供人工筛选复核。

## 运行方式

推荐在 VPS 上以 systemd timer 低频运行（默认每 6 小时一次）。项目默认从项目根目录读取 `.env` 配置，并将状态文件写到 `.data/`。

建议项目目录：

- `/root/seed/GitSearchooor`
- `/root/seed/GitSearchooor/.env`
- `/root/seed/GitSearchooor/.data/state.db`
- `/root/seed/GitSearchooor/.data/deadletter.jsonl`

## 依赖

必须依赖：

- Python 3
- GitHub CLI：`gh`
- Notion CLI：`ntn`

建议依赖：

- systemd（用于 timer）

## 配置（.env）

在项目根目录创建 `.env`：

```bash
GH_TOKEN=ghp_***
NOTION_API_TOKEN=ntn_***
NOTION_DATABASE_ID=35a08fc26c7380df8afaede20d028eed

STATE_DB_PATH=/root/seed/GitSearchooor/.data/state.db
DEADLETTER_PATH=/root/seed/GitSearchooor/.data/deadletter.jsonl

REPO_PUSHED_DAYS=7
GH_REPO_QUERY="web3 OR crypto OR x402 OR stablecoin OR coin archived:false fork:false is:public"

REPOS_PER_RUN=30
PER_REPO_CODE_HITS=10
LEAK_TERMS="seed phrase,seedphrase,mnemonic,private key,secret key,xprv,solana secret key"

MAX_CALLS_PER_MINUTE=40
MIN_INTERVAL_SEC=1.2
JITTER_SEC=0.8
BACKOFF_BASE_SEC=2
BACKOFF_MAX_SEC=120
BACKOFF_MAX_RETRIES=5

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

建议设置权限：

```bash
chmod 600 /root/seed/GitSearchooor/.env
```

## 本地手动运行

进入项目根目录：

```bash
cd /root/seed/GitSearchooor
```

查看最终配置（确认 `.env` 生效）：

```bash
python3 -m web3_secret_bot.cli print-config
```

初始化状态库：

```bash
python3 -m web3_secret_bot.cli init-db
```

Dry-run（不写入 Notion，仅把 payload 写入本地 events 方便排查）：

```bash
python3 -m web3_secret_bot.cli run --dry-run
```

真实写入：

```bash
python3 -m web3_secret_bot.cli run
```

## systemd 部署（推荐）

项目提供了 systemd 模板：

- `deploy/systemd/web3-secret-bot.service`
- `deploy/systemd/web3-secret-bot.timer`

将 service/timer 安装到系统：

```bash
cp /root/seed/GitSearchooor/deploy/systemd/web3-secret-bot.service /etc/systemd/system/
cp /root/seed/GitSearchooor/deploy/systemd/web3-secret-bot.timer /etc/systemd/system/
systemctl daemon-reload
```

启用并启动 timer：

```bash
systemctl enable --now web3-secret-bot.timer
```

查看下次运行时间与状态：

```bash
systemctl status web3-secret-bot.timer
systemctl list-timers --all | grep web3-secret-bot
```

手动触发一次运行（不改 timer 频率）：

```bash
systemctl start web3-secret-bot.service
```

查看日志：

```bash
journalctl -u web3-secret-bot.service -n 200 --no-pager
journalctl -u web3-secret-bot.service -f
```

停止/禁用：

```bash
systemctl disable --now web3-secret-bot.timer
```

## 常见排查

- Notion 写入失败：优先检查 Notion integration 是否已 share 该 database；再检查 `NOTION_API_TOKEN/NOTION_DATABASE_ID`；失败 payload 会追加到 `DEADLETTER_PATH`
- GitHub 403/429：适当降低 `REPOS_PER_RUN`、`PER_REPO_CODE_HITS`、`MAX_CALLS_PER_MINUTE` 或调大 `MIN_INTERVAL_SEC`
- `.env` 未生效：确认 systemd service 的 `WorkingDirectory` 为项目根目录；或显式使用 `--env-file /root/seed/GitSearchooor/.env`
