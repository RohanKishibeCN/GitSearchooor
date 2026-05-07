# Tasks
- [x] Task 1: 明确 Notion 数据库与字段映射
  - [x] 收集/确认 Notion Database ID、集成 Token 的配置方式（环境变量），以及数据库字段（仓库 URL、文件 URL、命中词、脱敏片段、时间、生态标签、状态等）
  - [x] 定义写入失败重试策略与幂等键（例如 repo+path+blob_sha+term 的哈希）

- [x] Task 2: 设计 GitHub 搜索策略（低频、可增量）
  - [x] 定义候选仓库查询：关键词集合、排序（updated/stars）、过滤（archived:false、fork:false、stars 下限可选）
  - [x] 定义“以太坊/ Solana 依赖判定”策略：优先查依赖文件（package.json、Cargo.toml、go.mod、requirements.txt 等）再补充代码搜索
  - [x] 定义泄露关键词查询：关键词集合、文件类型/路径约束、每仓库最大命中数
  - [x] 定义每轮扫描配额：每次运行最多处理多少仓库/多少搜索请求，并支持配置

- [x] Task 3: 实现 Bot 主流程（发现 → 判定 → 检索 → 脱敏 → 去重 → 入库）
  - [x] 使用 gh-cli 实现仓库搜索与分页游标
  - [x] 对每个仓库进行生态标签判定（ethereum/solana）
  - [x] 在仓库内进行泄露关键词 code search，收集命中文件信息
  - [x] 按需拉取命中文件片段并生成脱敏后的上下文（不保存完整敏感值）
  - [x] 写入本地状态库（SQLite）用于断点续扫与去重
  - [x] 通过 notion-cli 写入 Notion 数据库

- [x] Task 4: 速率控制与稳健性
  - [x] 实现全局限流（每分钟请求数/并发数）与随机抖动
  - [x] 处理 GitHub rate limit/403/429：指数退避、降低配额、记录事件
  - [x] 处理 Notion 写入失败：有限次重试与死信记录（本地）

- [x] Task 5: VPS 部署与运行方式
  - [x] 提供 systemd service + timer（或 cron）运行方式，默认低频（例如每 6 小时一次，可配置）
  - [x] 提供最小运行手册：环境变量（GH_TOKEN、NOTION_API_TOKEN、DATABASE_ID）、日志位置、状态库位置

- [x] Task 6: 验证与回归
  - [x] 增加最小可重复的验证方式：对少量已知公开仓库进行 dry-run（不写入 Notion）与真实写入测试
  - [x] 验证脱敏策略：Notion 中不出现完整敏感值
  - [x] 验证去重：重复运行不重复写入

# Task Dependencies
- Task 3 depends on Task 1
- Task 3 depends on Task 2
- Task 5 depends on Task 3
- Task 6 depends on Task 3
