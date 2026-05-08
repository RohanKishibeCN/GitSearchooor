- [ ] 运行形态：仅 VPS 运行，systemd timer 低频触发（默认每 6 小时一次，可配置）
- [ ] 配置方式：项目目录 `.env` 生效（例如 `/root/seed/GitSearchooor/.env`），修改后重启服务即可生效
- [ ] 状态文件：状态库与 deadletter 放在项目目录 `.data/`（例如 `/root/seed/GitSearchooor/.data/state.db`、`/root/seed/GitSearchooor/.data/deadletter.jsonl`）

- [ ] 仓库发现（策略 B）：候选仓库搜索默认只覆盖最近 N 天 pushed 的仓库（`REPO_PUSHED_DAYS`，默认 7）
- [ ] 生态判定：能判定候选仓库是否使用 ethereum 或 solana 相关库，并输出标签（ethereum / solana / both / unknown）
- [ ] 泄露检索：能在仓库内定位命中关键词的文件与位置，并生成结构化结果（repo、file path、blob sha、term、snippet）

- [ ] 脱敏：任何外部输出（Notion、本地状态、deadletter、日志）不包含完整私钥/助记词/secret key 原文
- [ ] 去重与 Upsert：幂等键为 `dedup_key`；首次命中创建 Notion 记录，重复命中更新 `Last Seen/Hit Count` 不新增行
- [ ] Notion Schema：Database 字段与类型与 spec 中列出的单表一致，字段映射可通过 `.env` 配置

- [ ] 速率控制：具备限流/抖动/退避；触发 rate limit（403/429）时自动退避并可继续运行
- [ ] 成本控制：优先使用 Search Code 的 fragment 作为上下文；避免 fragment 缺失时频繁拉取整文件内容

- [ ] 安全：`.env` 不进入仓库（`.gitignore`），token 不出现在仓库/日志/Notion 明文；`.env` 权限建议 600
- [ ] 验证：支持 dry-run（不写 Notion）与真实写入；重复运行验证 upsert；脱敏与去重验证通过
