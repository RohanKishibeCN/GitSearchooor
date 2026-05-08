# Web3 GitHub 泄露线索扫描 Bot Spec

## Why
需要在 VPS 上持续、低频率地扫描 GitHub Public 项目里可能存在的钱包助记词/私钥等泄露线索，并把命中结果沉淀到 Notion 数据库，便于后续人工复核与处置。

## Decisions (已确认)
- 运行形态：仅使用 VPS（24 小时在线），用 systemd timer 低频运行
- 配置方式：以项目目录下 `.env` 为主（例如 `/root/seed/GitSearchooor/.env`），便于后期调整
- 扫描策略：采用策略 B（时间窗口），默认仅扫描最近 N 天内 pushed 的仓库（N 可配置，默认 7 天）
- 命中策略：先全抓再人工过滤（允许误报，以 Notion 侧筛选为主）
- Notion：在一个 Page 内新建一个 Database（单表），Bot 写入/更新该 Database
- 状态文件：放在项目目录内（例如 `/root/seed/GitSearchooor/.data/state.db`、`/root/seed/GitSearchooor/.data/deadletter.jsonl`）

## What Changes
- 新增一个可部署在 VPS 的定时扫描 Bot：使用 GitHub CLI 获取候选仓库与命中代码位置，并在本地做二次解析与去重后写入 Notion 数据库；重复命中时更新 Notion 记录的 `Last Seen/Hit Count`
- 新增一套“候选仓库筛选 + 依赖判定 + 关键词命中”规则，可配置关键词、语言/文件类型与扫描上限
- 新增本地状态存储（SQLite 或等价方式）用于去重、Notion upsert 映射（dedup_key→page_id）、以及事件记录（限流/失败）
- 新增速率控制策略（限流、抖动、退避、分批）以降低触发 GitHub 风控/封禁风险
- 新增输出规范：Notion 记录包含仓库/文件/命中片段（脱敏）与复核字段

## Impact
- Affected specs: GitHub 搜索与取文件内容、规则筛选、脱敏与去重、Notion 入库、定时与部署运维
- Affected code: 新增 Bot 程序（脚本/服务）、配置文件、状态库、部署单元（systemd/cron）与运行文档（仅在实现阶段提供）

## 可行性与主要问题
- 可行性：可行，但需要用“GitHub Search + 小规模取样读取”替代“全量 clone + 全量扫描”，否则成本高且更容易触发限流
- GitHub 限制：Search API 本身有速率与返回上限；需要分批、轮转查询与缓存结果，避免频繁重复检索同一仓库
- 误报/噪声：仅用 seedphrase/mnemonic/private key 等词会产生大量误报（示例、测试数据、文档说明）；本项目选择“先全抓再人工过滤”，以 Notion 侧筛选为主
- 合规/风险：即使信息来自 public repo，也应当默认进行脱敏，不在 Notion 中写入完整私钥/助记词；只保存必要的“线索片段 + 定位信息”以便人工复核
- “关注引用 ether/solana 库”需要明确：是指 JavaScript 的 ethers、Rust 的 solana-sdk、Python 的 solana/anchorpy 等；需提供可配置库清单并按生态分别匹配
- “扫描频率适中”需要量化：建议以“每次运行扫描上限 + 每小时/每天运行次数”定义，并支持按 GitHub 限流反馈自适应降速

## Runtime (VPS)
- 推荐工作目录：`/root/seed/GitSearchooor`
- 环境文件：`/root/seed/GitSearchooor/.env`
- 状态目录：`/root/seed/GitSearchooor/.data/`
- 定时：systemd timer，默认每 6 小时一次（可配置）

## Configuration (环境变量)
以下为 MUST/SHOULD 配置项（均建议写入 `.env`）：

### Required
- `GH_TOKEN`
- `NOTION_API_TOKEN`
- `NOTION_DATABASE_ID`

### Core Scanning
- `REPO_PUSHED_DAYS`：策略 B 的时间窗口天数（默认 7）
- `GH_REPO_QUERY`：候选仓库 query 的基础部分（不含 pushed 条件时也能运行）
- `REPOS_PER_RUN`：每轮最多处理的仓库数
- `PER_REPO_CODE_HITS`：每仓库每个 term 最多命中条数
- `LEAK_TERMS`：逗号分隔的泄露线索关键词列表

### Local State
- `STATE_DB_PATH`：建议 `/root/seed/GitSearchooor/.data/state.db`
- `DEADLETTER_PATH`：建议 `/root/seed/GitSearchooor/.data/deadletter.jsonl`

### Rate Limit / Backoff
- `MAX_CALLS_PER_MINUTE`
- `MIN_INTERVAL_SEC`
- `JITTER_SEC`
- `BACKOFF_BASE_SEC`
- `BACKOFF_MAX_SEC`
- `BACKOFF_MAX_RETRIES`

### Ecosystem Detection (optional)
- `DEPENDENCY_FILES`
- `ETHEREUM_MARKERS`
- `SOLANA_MARKERS`

### Notion Mapping
Notion Database 字段（列名）与 Bot 字段的映射均需可配置，以避免后续改列名必须改代码。

Bot 字段 → Notion 列名（默认值为下面列名）：
- `NOTION_PROP_TITLE` → `Title`
- `NOTION_PROP_REPO_URL` → `Repo URL`
- `NOTION_PROP_FILE_URL` → `File URL`
- `NOTION_PROP_FILE_PATH` → `File Path`
- `NOTION_PROP_TERM` → `Term`
- `NOTION_PROP_ECOSYSTEM` → `Ecosystem`
- `NOTION_PROP_SNIPPET` → `Snippet (Masked)`
- `NOTION_PROP_BLOB_SHA` → `Blob SHA`
- `NOTION_PROP_DEDUP_KEY` → `Dedup Key`
- `NOTION_PROP_FIRST_SEEN` → `First Seen`
- `NOTION_PROP_LAST_SEEN` → `Last Seen`
- `NOTION_PROP_HIT_COUNT` → `Hit Count`
- `NOTION_PROP_STATUS` → `Status`
- `NOTION_PROP_NOTES` → `Notes`
- `NOTION_PROP_TAGS` → `Tags`
- `NOTION_DEFAULT_STATUS`：默认状态（例如 `待复核`）

## Notion Schema (单表)
Notion Database 字段如下（已确认）：
- Title（title，数据库自带的标题列，命名为 Title）
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

## Notion Upsert 语义
- 幂等键：`dedup_key = sha256(repo + path + blob_sha + term)`
- 首次命中（dedup_key 不存在）：创建 Notion Page，写入 `First Seen=Last Seen=now`、`Hit Count=1`
- 重复命中（dedup_key 已存在）：更新同一 Notion Page，写入 `Last Seen=now`、`Hit Count += 1`（可选：Term 追加）

## Security
- Notion integration token、GitHub token MUST 仅保存在 VPS 的 `.env` 中，不得出现在仓库、日志、Notion 明文字段或 deadletter 原文中
- `.env` MUST 加入 `.gitignore`，并限制文件权限（建议 600）
- 所有写入 Notion 与本地状态/日志的片段必须脱敏（不落完整私钥/助记词/secret 原文）

## ADDED Requirements
### Requirement: 仓库发现与筛选
系统 SHALL 使用 GitHub CLI 在 GitHub Public 仓库中检索候选项目，并基于关键词与基础质量指标筛选后进入下一阶段；默认仅扫描最近 N 天内 pushed 的仓库（策略 B）。

#### Scenario: Success case
- **WHEN** 定时任务触发一次扫描
- **THEN** 系统从 GitHub 搜索获得候选仓库列表（按更新时间/热度排序、分页）
- **AND THEN** 系统仅保留满足关键词条件（web3/crypto/x402/stablecoin/coin 等可配置）且不在黑名单中的仓库

### Requirement: 依赖/生态判定（以太坊/ Solana）
系统 SHALL 在候选仓库中判定是否使用以太坊或 Solana 相关库，并将其作为“优先扫描”信号。

#### Scenario: Success case
- **WHEN** 仓库被纳入候选集
- **THEN** 系统通过依赖文件与/或代码搜索判定是否引用了配置中的以太坊库或 Solana 库
- **AND THEN** 系统为仓库打上标签（ethereum / solana / both / unknown）并用于后续排序与配额分配

### Requirement: 泄露关键词检索
系统 SHALL 在入选仓库内检索包含泄露线索关键词的文件，并收集命中位置与上下文片段。

#### Scenario: Success case
- **WHEN** 仓库被标记为可扫描
- **THEN** 系统使用 GitHub CLI 进行代码搜索（优先针对配置的文件类型/目录），找到命中文件路径与行号/片段
- **AND THEN** 系统为每条命中生成结构化记录（仓库、分支/commit、文件路径、命中词、上下文片段）

### Requirement: 脱敏与安全处理
系统 SHALL 对疑似敏感值进行脱敏后再写入任何持久化存储或外部系统。

#### Scenario: Success case
- **WHEN** 命中片段包含疑似私钥/助记词/secret key
- **THEN** 系统在 Notion 与本地日志中仅保存脱敏片段（例如仅保留首尾若干字符或哈希）与定位信息

### Requirement: Notion 入库
系统 SHALL 将命中结果写入用户指定的 Notion 数据库（Database），用于人工复核；重复命中时更新同一条记录的 `Last Seen/Hit Count`。

#### Scenario: Success case
- **WHEN** 产生一条新的、未重复上报的命中记录
- **THEN** 系统通过 Notion CLI 创建一条数据库记录
- **AND THEN** 记录包含：仓库 URL、文件 URL、命中关键词、脱敏片段、扫描时间、生态标签、状态（待复核/已处理）

### Requirement: 断点续扫与去重
系统 SHALL 维护扫描状态，避免重复写入与便于后续 upsert；策略 B 通过时间窗口降低重复扫描成本。

#### Scenario: Success case
- **WHEN** 同一仓库/文件在后续扫描中再次命中相同内容
- **THEN** 系统识别为重复并跳过 Notion 写入
- **AND THEN** 系统继续推进游标到后续仓库/分页

### Requirement: 速率控制与抗封禁
系统 SHALL 以保守策略访问 GitHub 接口，并在限流/风控信号出现时自动降速与退避。

#### Scenario: Success case
- **WHEN** GitHub 返回 rate limit 或 403/429 等信号
- **THEN** 系统指数退避并降低每轮扫描配额
- **AND THEN** 系统在下一轮恢复前引入随机抖动并记录限流事件

## MODIFIED Requirements
### Requirement: 关键词与库清单可配置
系统 SHALL 将“项目关键词（web3/crypto/x402/stablecoin/coin 等）”“依赖库清单（ethereum/solana 生态）”“泄露关键词（seedphrase/mnemonic/private key 等）”配置化，并支持热更新或重启生效。

## REMOVED Requirements
### Requirement: 全量克隆并本地全文扫描
**Reason**: 全量 clone/全文扫描成本高且更易触发 GitHub 风控与限流
**Migration**: 使用 GitHub Search + 按需拉取单文件内容/片段的方式实现等价效果，并通过配额与缓存控制扫描量
