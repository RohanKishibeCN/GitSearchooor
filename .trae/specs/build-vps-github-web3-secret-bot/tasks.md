# Tasks
- [ ] Task 0: 冻结方案口径（已确认决策落文档）
  - [x] 运行形态：VPS + systemd timer
  - [x] 配置方式：项目目录 `.env`
  - [x] 扫描策略：策略 B（pushed 时间窗口，默认 7 天）
  - [x] Notion Schema：单表字段已固定
  - [x] 状态文件：项目目录 `.data/`

- [ ] Task 1: Notion 数据库字段映射与 upsert 语义落地
  - [x] 确认 Database ID 与字段列表
  - [ ] 扩展 Notion 字段映射（File Path / Blob SHA / First Seen / Last Seen / Hit Count / Notes / Tags）
  - [ ] 设计并实现 Notion upsert：新增命中 create page，重复命中 update page（Last Seen + Hit Count）
  - [ ] 在本地状态库持久化 `dedup_key -> notion_page_id` 映射（用于稳定更新同一条记录）

- [ ] Task 2: 搜索策略 B（时间窗口）落地
  - [ ] 新增 `REPO_PUSHED_DAYS` 配置项（默认 7）
  - [ ] 每轮运行时动态拼接 `pushed:>=YYYY-MM-DD` 到 repo search query，降低重复扫描成本
  - [ ] 明确每轮配额：`REPOS_PER_RUN`、`PER_REPO_CODE_HITS`、`LEAK_TERMS` 组合的上限与降级规则

- [ ] Task 3: GitHub 结果质量与成本控制
  - [ ] 启用 Search Code 的 text match（fragment）返回，优先使用 fragment 生成上下文
  - [ ] 避免 fragment 缺失时盲目拉取整文件开头，改为按需拉取更小片段或增加保护阈值
  - [ ] 记录每轮 GitHub 调用计数与耗时（便于调参）

- [ ] Task 4: 部署与运行（VPS）
  - [ ] systemd service/timer 对齐最终路径：WorkingDirectory 指向项目目录，EnvironmentFile 指向 `.env`
  - [ ] 状态目录使用项目内 `.data/`，并确保权限/持久化
  - [ ] 增加最小运行手册（`.env` 说明、依赖安装、启动/停止/查看日志、dry-run 与真实写入）
  - [ ] 确保 `.env` 加入 `.gitignore`，避免误提交

- [ ] Task 5: 稳健性与回归验证
  - [ ] dry-run：不写入 Notion，仅输出统计与 sample payload（脱敏）
  - [ ] upsert 验证：重复运行同一命中，Notion 仅更新 `Last Seen/Hit Count` 不新增行
  - [ ] 脱敏验证：Notion、本地状态、deadletter 中不出现完整敏感值
  - [ ] 速率/退避验证：触发 403/429 时可自动退避并继续运行

# Task Dependencies
- Task 1 depends on Task 0
- Task 2 depends on Task 0
- Task 3 depends on Task 2
- Task 4 depends on Task 1
- Task 5 depends on Task 1
