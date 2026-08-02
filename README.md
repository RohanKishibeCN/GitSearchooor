# GitSearchooor

VPS 上常驻运行（pm2）扫描 GitHub Public 仓库中的 Web3 泄露线索（助记词/私钥/secret 等），将命中结果脱敏后写入 Notion Database，供人工筛选复核。

完整部署与运维手册见 [OPERATION.md](OPERATION.md)。

## 运行方式

推荐在 VPS 上用 pm2 常驻跑 `loop` 模式。程序会根据 GitHub rate limit 自动 sleep，自适应决定下一轮运行时间（更稳但更慢）。

建议项目目录：

- `/root/seed/GitSearchooor`
- `/root/seed/GitSearchooor/.env`
- `/root/seed/GitSearchooor/.data/state.db`
- `/root/seed/GitSearchooor/.data/deadletter.jsonl`

## 依赖

必须依赖：

- Node.js 20+
- npm
- pm2（用于进程管理）

## 配置（.env）

在项目根目录创建 `.env`：

```bash
GITHUB_TOKEN=ghp_***
NOTION_TOKEN=secret_***
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

SQLITE_DB_PATH=/root/seed/GitSearchooor/.data/state.db
DEADLETTER_PATH=/root/seed/GitSearchooor/.data/deadletter.jsonl

GITHUB_REPO_PUSHED_DAYS=7
GITHUB_REPO_QUERY="ethereum OR solidity OR solana OR \"smart contract\" OR defi archived:false fork:false is:public stars:<2000"
GITHUB_REPO_SEARCH_PAGE_LIMIT=3

GITHUB_REPOS_PER_RUN=10
GITHUB_PER_REPO_CODE_HITS=5
GITHUB_MAX_HITS_PER_REPO=3
GITHUB_PATH_FILTER_ENABLED=1
GITHUB_PATH_EXCLUDE_EXTENSIONS=".md,.mdx,.rst,.sol,.pyc,.class,.o,.png,.jpg,.jpeg,.gif,.svg,.ico,.pdf,.doc,.docx,.zip,.tar.gz,.7z,.lock"
GITHUB_PATH_EXCLUDE_CONTAINS="docs/,doc/,examples/,example/,test/,tests/,spec/,__test__/,__fixtures__/,mocks/,mock/,migrations/,dist/,build/,out/,target/,artifacts/,cache/,templates/,template/,.github/,git-hooks/,vendor/,node_modules/"
GITHUB_PATH_EXCLUDE_BASENAMES="readme.md,readme.mdx,contributing.md,changelog.md,license,.gitignore,.prettierrc,.eslintrc,.editorconfig"
GITHUB_CONTENT_FILTER_ENABLED=1
GITHUB_CONTENT_EXCLUDE_KEYWORDS="your_private_key,your mnemonic,your seed phrase,example,examples,demo,placeholder,replace_with,replace me,changeme,test test test test,0xac0974be,0x59c6995e,0x5de4111a,0x7c852118,0x47e179ec,<YOUR_PRIVATE_KEY>,<YOUR_MNEMONIC>,YOUR_SEED_PHRASE,CHANGE_THIS,REPLACE_ME,XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX,00000000000000000000000000000000,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
# 建议开启：必须命中实际密文格式（hex 私钥/助记词/base58）才入库，否则大量测试/示例会误报
GITHUB_REQUIRE_SECRET_PATTERN=1
GITHUB_SECRET_PATTERN_BASE58_MIN_LEN=80
GITHUB_SECRET_PATTERN_ENABLE_BASE58=1
GITHUB_SECRET_PATTERN_ENABLE_MNEMONIC=1
LEAK_TERMS="mnemonic,seed phrase,seedphrase,xprv,private key,secret key,solana secret key,PRIVATE_KEY,SECRET_KEY,MNEMONIC,SEED_PHRASE,WALLET_PRIVATE_KEY,DEPLOYER_PRIVATE_KEY,OWNER_PRIVATE_KEY,ADMIN_PRIVATE_KEY,SOLANA_PRIVATE_KEY"

GITHUB_SEARCH_MIN_REMAINING=3
GITHUB_CORE_MIN_REMAINING=50
GITHUB_HTTP_TIMEOUT_SEC=60
GITHUB_MAX_CONCURRENCY=1

LOOP_MIN_INTERVAL_SEC=3600
LOOP_MAX_INTERVAL_SEC=21600
LOOP_JITTER_SEC=120

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

NOTION_VALIDATE_EACH_LOOP=0
NOTION_BACKFILL_MISSING_PAGE=1
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

安装依赖与构建：

```bash
npm ci
npm run build
```

查看最终配置（确认 `.env` 生效）：

```bash
node dist/cli.js print-config
```

初始化状态库：

```bash
node dist/cli.js init-db
```

Dry-run（不写入 Notion，仅把 payload 写入本地 events 方便排查）：

```bash
node dist/cli.js run --dry-run
```

真实写入：

```bash
node dist/cli.js run
```

## pm2 部署（推荐）

在项目根目录启动常驻 loop：

```bash
pm2 start dist/cli.js --name gitsearchooor -- loop
pm2 ls
```

查看日志：

```bash
pm2 logs gitsearchooor --lines 200
```

## 常见排查

- Notion 写入失败：先检查 Notion integration 是否已 share 该 database；再检查 `NOTION_TOKEN/NOTION_DATABASE_ID`；失败 payload 会追加到 `DEADLETTER_PATH`
- GitHub 403/429：程序会自动睡到 reset；想更保守可减小 `GITHUB_REPOS_PER_RUN/GITHUB_PER_REPO_CODE_HITS` 或提高 `LOOP_MIN_INTERVAL_SEC`
- `.env` 未生效：确认 pm2 的启动目录为项目根目录，或显式传参 `--env-file /root/seed/GitSearchooor/.env`
