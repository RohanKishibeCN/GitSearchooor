# GitSearchooor 操作手册（VPS，pm2）

本文档面向在 VPS 上运行 GitSearchooor（TypeScript 版）的常见操作：部署、参数配置、状态检查、日志查看、排障与升级。

推荐项目目录：

- 项目：`/root/seed/GitSearchooor`
- 环境：`/root/seed/GitSearchooor/.env`
- 状态：`/root/seed/GitSearchooor/.data/`

## 0. 安全要求（必须先看）

- Notion token / GitHub token 只能放在 VPS 的 `.env`，不要粘贴到聊天、不要写入仓库、不要出现在日志里
- 如果 token 已经暴露，立即 revoke 并重新生成
- `.env` 权限建议为 600

## 1. 依赖安装

必须依赖：

- Node.js 20+
- npm
- pm2

验证：

```bash
node --version
npm --version
pm2 --version
```

## 2. 拉取代码与目录准备

```bash
cd /root/seed
git clone https://github.com/RohanKishibeCN/GitSearchooor.git
cd /root/seed/GitSearchooor

mkdir -p /root/seed/GitSearchooor/.data
chmod 700 /root/seed/GitSearchooor/.data
```

安装依赖与构建：

```bash
npm ci
npm run build
```

## 3. Notion 准备（严格字段类型）

1. 在 Notion 新建一个 Page
2. 在该 Page 中新建一个 Database（表格）
3. 按下面“字段与映射”创建字段（类型必须一致）
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
GITHUB_TOKEN=ghp_***
NOTION_TOKEN=secret_***
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4.2 状态文件（放项目目录）

```bash
SQLITE_DB_PATH=/root/seed/GitSearchooor/.data/state.db
DEADLETTER_PATH=/root/seed/GitSearchooor/.data/deadletter.jsonl
```

### 4.3 扫描策略（时间窗口）

```bash
GITHUB_REPO_PUSHED_DAYS=7
GITHUB_REPO_QUERY="(evm OR ethereum OR solidity OR solc OR foundry OR forge OR cast OR hardhat OR truffle OR ethers OR viem OR wagmi OR metamask OR openzeppelin OR uniswap OR aave OR chainlink OR flashbots OR mev OR erc20 OR erc721 OR erc1155) OR (solana OR \"@solana/web3.js\" OR solana-sdk OR solana_sdk:: OR anchor OR anchor-lang OR anchor_lang:: OR spl-token OR token-2022 OR raydium OR jupiter) archived:false fork:false is:public"
GITHUB_REPOS_PER_RUN=30
GITHUB_PER_REPO_CODE_HITS=10
GITHUB_MAX_HITS_PER_REPO=10
GITHUB_PATH_FILTER_ENABLED=1
GITHUB_PATH_EXCLUDE_EXTENSIONS=".md,.mdx,.rst"
GITHUB_PATH_EXCLUDE_CONTAINS="docs/,doc/,examples/,example/"
GITHUB_PATH_EXCLUDE_BASENAMES="readme.md,readme.mdx,contributing.md,changelog.md,license"
GITHUB_CONTENT_FILTER_ENABLED=1
GITHUB_CONTENT_EXCLUDE_KEYWORDS="your_private_key,your mnemonic,your seed phrase,example,examples,demo,placeholder,replace_with,replace me,changeme"
GITHUB_REQUIRE_SECRET_PATTERN=0
GITHUB_SECRET_PATTERN_BASE58_MIN_LEN=80
GITHUB_SECRET_PATTERN_ENABLE_BASE58=1
GITHUB_SECRET_PATTERN_ENABLE_MNEMONIC=1
LEAK_TERMS="mnemonic,seed phrase,seedphrase,xprv,private key,secret key,solana secret key,PRIVATE_KEY,SECRET_KEY,MNEMONIC,SEED_PHRASE,WALLET_PRIVATE_KEY,DEPLOYER_PRIVATE_KEY,OWNER_PRIVATE_KEY,ADMIN_PRIVATE_KEY,SOLANA_PRIVATE_KEY"
```

注意：

- 有空格的值建议用双引号包起来（如 `LEAK_TERMS`、`GITHUB_REPO_QUERY`）
- 想更稳：优先减小 `GITHUB_REPOS_PER_RUN`、`GITHUB_PER_REPO_CODE_HITS`，再提高 `LOOP_MIN_INTERVAL_SEC`

### 4.4 稳态限额与 loop（更稳但更慢）

```bash
GITHUB_SEARCH_MIN_REMAINING=3
GITHUB_CORE_MIN_REMAINING=50
GITHUB_HTTP_TIMEOUT_SEC=60
GITHUB_MAX_CONCURRENCY=1

LOOP_MIN_INTERVAL_SEC=3600
LOOP_MAX_INTERVAL_SEC=21600
LOOP_JITTER_SEC=120
```

### 4.5 Notion 字段与映射（单表）

Notion Database 字段（类型必须一致）：

- Title（title）
- Repo URL（url）
- File URL（url）
- File Path（rich_text）
- Term（multi_select）
- Ecosystem（select：ethereum / solana / both / unknown）
- Snippet (Masked)（rich_text）
- Blob SHA（rich_text）
- Dedup Key（rich_text）
- First Seen（date）
- Last Seen（date）
- Hit Count（number）
- Status（select：待复核 / 已确认 / 误报 / 已处理）
- Notes（rich_text）
- Tags（multi_select）

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

Notion schema 校验策略（默认只在启动时校验一次）：

```bash
NOTION_VALIDATE_EACH_LOOP=0
```

Notion 补写策略（当命中已写入 SQLite 但 notion_page_id 为空时，是否自动创建页面；默认开启，避免先 dry-run 再 run 导致不写入 Notion）：

```bash
NOTION_BACKFILL_MISSING_PAGE=1
```

## 5. 手动运行（建议先 dry-run）

进入项目目录：

```bash
cd /root/seed/GitSearchooor
```

确认 `.env` 生效（不触发扫描）：

```bash
node dist/cli.js print-config
```

初始化状态库：

```bash
node dist/cli.js init-db
```

Dry-run（不写 Notion）：

```bash
node dist/cli.js run --dry-run
```

真实写入：

```bash
node dist/cli.js run
```

验证 upsert：

- 第一次 run：Notion 应新增行
- 第二次 run：相同命中不新增行，而是更新同一行的 `Last Seen/Hit Count`

## 6. pm2 部署（常驻 loop）

进入项目目录后启动（必须在项目根目录启动，确保 `.env` 生效）：

```bash
cd /root/seed/GitSearchooor
pm2 start dist/cli.js --name gitsearchooor -- loop
pm2 ls
```

常用操作：

```bash
pm2 restart gitsearchooor
pm2 stop gitsearchooor
pm2 delete gitsearchooor
```

查看日志：

```bash
pm2 logs gitsearchooor --lines 200
```

## 7. 状态检查

查看状态文件：

```bash
ls -lh /root/seed/GitSearchooor/.data/
```

查看 deadletter（Notion 写入失败）：

```bash
tail -n 50 /root/seed/GitSearchooor/.data/deadletter.jsonl
```

## 8. 常见故障排查

### 8.1 Notion 写入失败（400/403）

- 确认 Notion database 已 share 给 integration
- 检查 `.env` 的 `NOTION_TOKEN/NOTION_DATABASE_ID`
- 检查字段映射列名是否与 Notion 完全一致（包含大小写与空格）
- 可以临时设置 `NOTION_VALIDATE_EACH_LOOP=1` 以便快速定位字段问题
- 失败 payload 会落到 `DEADLETTER_PATH`

### 8.2 GitHub 403/429 或 rate limit

- 程序会自动 sleep 到 reset
- 想更稳：降低 `GITHUB_REPOS_PER_RUN`、`GITHUB_PER_REPO_CODE_HITS`，并提高 `LOOP_MIN_INTERVAL_SEC`

### 8.3 `.env` 未生效

- 确认在项目根目录执行 `pm2 start ...`
- 或在 pm2 启动命令中显式传参：

```bash
pm2 start dist/cli.js --name gitsearchooor -- loop --env-file /root/seed/GitSearchooor/.env
```

## 9. 升级与回滚

升级：

```bash
cd /root/seed/GitSearchooor
git pull --ff-only
npm ci
npm run build
pm2 restart gitsearchooor
```

回滚（示例：回到某个 commit）：

```bash
cd /root/seed/GitSearchooor
git checkout <commit-sha>
npm ci
npm run build
pm2 restart gitsearchooor
```
