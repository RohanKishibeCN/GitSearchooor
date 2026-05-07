# Web3 GitHub 泄露线索扫描 Bot Spec

## Why
需要在 VPS 上持续、低频率地扫描 GitHub Public 项目里可能存在的钱包助记词/私钥等泄露线索，并把命中结果沉淀到 Notion 数据库，便于后续人工复核与处置。

## What Changes
- 新增一个可部署在 VPS 的定时扫描 Bot：使用 GitHub CLI 获取候选仓库与命中代码位置，并在本地做二次解析与去重后写入 Notion 数据库
- 新增一套“候选仓库筛选 + 依赖判定 + 关键词命中”规则，可配置关键词、语言/文件类型与扫描上限
- 新增本地状态存储（SQLite 或等价方式）用于断点续扫、去重与速率控制
- 新增速率控制策略（限流、抖动、退避、分批）以降低触发 GitHub 风控/封禁风险
- 新增输出规范：Notion 记录包含仓库/文件/命中片段（脱敏）与复核字段

## Impact
- Affected specs: GitHub 搜索与取文件内容、规则筛选、脱敏与去重、Notion 入库、定时与部署运维
- Affected code: 新增 Bot 程序（脚本/服务）、配置文件、状态库、部署单元（systemd/cron）与运行文档（仅在实现阶段提供）

## 可行性与主要问题
- 可行性：可行，但需要用“GitHub Search + 小规模取样读取”替代“全量 clone + 全量扫描”，否则成本高且更容易触发限流
- GitHub 限制：Search API 本身有速率与返回上限；需要分批、轮转查询与缓存结果，避免频繁重复检索同一仓库
- 误报/噪声：仅用 seedphrase/mnemonic/private key 等词会产生大量误报（示例、测试数据、文档说明）；需要提高命中质量（文件类型、上下文、熵/格式校验、黑白名单）
- 合规/风险：即使信息来自 public repo，也应当默认进行脱敏，不在 Notion 中写入完整私钥/助记词；只保存必要的“线索片段 + 定位信息”以便人工复核
- “关注引用 ether/solana 库”需要明确：是指 JavaScript 的 ethers、Rust 的 solana-sdk、Python 的 solana/anchorpy 等；需提供可配置库清单并按生态分别匹配
- “扫描频率适中”需要量化：建议以“每次运行扫描上限 + 每小时/每天运行次数”定义，并支持按 GitHub 限流反馈自适应降速

## ADDED Requirements
### Requirement: 仓库发现与筛选
系统 SHALL 使用 GitHub CLI 在 GitHub Public 仓库中检索候选项目，并基于关键词与基础质量指标筛选后进入下一阶段。

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
系统 SHALL 将命中结果写入用户指定的 Notion 数据库（Database），用于人工复核。

#### Scenario: Success case
- **WHEN** 产生一条新的、未重复上报的命中记录
- **THEN** 系统通过 Notion CLI 创建一条数据库记录
- **AND THEN** 记录包含：仓库 URL、文件 URL、命中关键词、脱敏片段、扫描时间、生态标签、状态（待复核/已处理）

### Requirement: 断点续扫与去重
系统 SHALL 维护扫描状态，避免重复扫描与重复上报。

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
