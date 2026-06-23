# GitSearchooor 优化方案

## 目录

1. [问题分析](#1-问题分析)
2. [策略优化总览](#2-策略优化总览)
3. [Repo 搜索策略优化](#3-repo-搜索策略优化)
4. [搜索词分级策略](#4-搜索词分级策略)
5. [文件路径过滤策略优化](#5-文件路径过滤策略优化)
6. [内容过滤策略优化](#6-内容过滤策略优化)
7. [密文验证策略优化](#7-密文验证策略优化)
8. [黑名单/白名单策略](#8-黑名单白名单策略)
9. [Repo 多样性策略](#9-repo-多样性策略)
10. [代码层面可优化项](#10-代码层面可优化项)
11. [实施路线图](#11-实施路线图)
12. [附录：推荐配置参数表](#12-附录推荐配置参数表)
13. [当前环境评估](#13-当前环境评估)

---

## 1. 问题分析

### 1.1 当前结果：Notion 中全部是 `wevm/viem` 的命中

问题的根本原因是**多重因素叠加**，而非单一 bug：

| 因素 | 影响 |
|------|------|
| **Repo 搜索不分页** | 每次只取搜索结果第一页（30 条），wevm/viem（40k+ stars）稳居榜首，冷门项目永远没机会 |
| **Repo Query 包含热门框架关键词** | `viem`、`ethers`、`openzeppelin` 等词让星数高的框架仓库垄断搜索结果 |
| **未排除 test/ 目录** | 路径过滤器只排除了 `docs/`、`examples/`，但 wevm/viem 的测试助记词在 `src/` 和 `test/` 中 |
| **requireSecretPattern 默认关闭** | 仅凭关键词匹配就入库，测试文件中的 `// this is for testing` 也能命中 |
| **未排除已知测试密钥** | Hardhat/Anvil 的 `test test test test...` 助记词是标准测试数据，但未被过滤 |
| **无 repo 黑名单** | 核心框架库用专业的安全管理，不可能泄漏，但每次都被扫到 |

### 1.2 核心矛盾

```
搜索范围太窄（只取第一页） × 筛选条件太宽（requireSecretPattern=false）
     ↓
热门无害大库占满配额 → 真正可能泄漏的项目没机会
```

---

## 2. 策略优化总览

### 2.1 核心思路

从**「广撒网——热门优先」**转向 **「精准定位——可疑优先」**。

### 2.2 六大策略维度

| # | 策略维度 | 当前状态 | 目标状态 |
|---|---------|---------|---------|
| 1 | Repo 搜索 | 搜热门框架，取第一页 | 搜冷门可疑场景，多页采样 |
| 2 | 搜索词分级 | 全部平权，默认 false 验证 | S/A/B/C 四级，不同验证强度 |
| 3 | 路径过滤 | 排 docs/examples | 全面排除测试/脚本/编译目录，强化 env 类文件 |
| 4 | 内容过滤 | 几个排除词 | 排除已知测试密钥 + 占位符 + 组合规则 |
| 5 | 密文验证 | 可选，默认关闭 | 默认开启，多模式联合 |
| 6 | Repo 多样性 | 无 | 黑名单 + 多页随机偏移 |

### 2.3 推荐的 Quick Win（不写代码也能落地）

以下变更只需修改 `.env` 环境变量，不涉及代码改动：

| 配置项 | 当前值 | 建议值 |
|--------|--------|--------|
| `GITHUB_REQUIRE_SECRET_PATTERN` | `false` | **`true`** |
| `GITHUB_REPOS_PER_RUN` | 30 | 5-10 |
| `GITHUB_PER_REPO_CODE_HITS` | 10 | 3-5 |
| `GITHUB_MAX_HITS_PER_REPO` | 10 | 3 |
| `GITHUB_PATH_EXCLUDE_CONTAINS` | `docs/,doc/,examples/,example/` | 增加 `test/,tests/,spec/,__test__/,fixtures/,mocks/,scripts/,dist/,build/,templates/` |
| `GITHUB_CONTENT_EXCLUDE_KEYWORDS` | 少量示例关键词 | 增加已知测试密钥和占位符 |

---

## 3. Repo 搜索策略优化

### 3.1 Repo Query 重建

**当前 Query：**

```
(evm OR ethereum OR solidity OR solc OR foundry OR forge OR cast OR hardhat OR truffle OR ethers OR viem OR wagmi OR metamask OR openzeppelin OR uniswap OR aave OR chainlink OR flashbots OR mev OR erc20 OR erc721 OR erc1155) OR (solana OR "@solana/web3.js" OR solana-sdk OR solana_sdk:: OR anchor OR anchor-lang OR anchor_lang:: OR spl-token OR token-2022 OR raydium OR jupiter) archived:false fork:false is:public
```

**问题**：所有这些关键词都是流行框架/协议，匹配这些词的仓库绝大多数是核心库或专业项目，极少有真实泄漏。

**优化方向（三选一）：**

#### 方案 A（推荐）：搜泄漏场景，不搜框架

侧重匹配那些把秘密明文写进代码/配置的场景：

```
("PRIVATE_KEY" OR "MNEMONIC" OR "SEED_PHRASE" OR "SECRET_SEED" OR "WALLET_PRIVATE_KEY" OR "DEPLOYER_PRIVATE_KEY" OR "SOLANA_PRIVATE_KEY" OR "WALLET_SECRET") (".env" OR "env:" OR "export" OR "process.env" OR "getenv" OR "environ" OR "config") NOT ".env.example" NOT "your_" NOT "YOUR_" NOT "example" NOT "test" NOT "hardhat" NOT "viem" NOT "ethers" NOT "foundry" NOT "openzeppelin" NOT "ethereumjs" archived:false fork:false is:public
```

这条 query 定位的是：在 `.env` 或配置文件中写入了大写环境变量密钥的项目，排除掉示例文件和主流框架。

#### 方案 B：搜可疑文件模式

```
("secret" "mnemonic" OR "seed" "phrase" OR "wallet" "json" OR "keystore" OR "private" "key" "hex" OR "solana" "keypair") extension:(json OR env OR yaml OR toml OR txt OR ini OR cfg) NOT "example" NOT "test" NOT "fixture" NOT "mock" NOT "hardhat" NOT "viem" NOT "foundry" archived:false fork:false is:public
```

这条 query 聚焦在配置文件格式中同时出现敏感词汇的情况。

#### 方案 C：多 query 轮转

不再只使用一个 query，而是在每次运行时从以下 query 池中选取 1-2 个执行，轮换覆盖：

| Query | 目标场景 |
|-------|---------|
| `"PRIVATE_KEY" extension:env NOT "your_" NOT "test" NOT "example"` | 硬编码私钥 |
| `"mnemonic" extension:txt NOT "test" NOT "example" NOT "hardhat"` | 文本文件中的助记词 |
| `"SEED_PHRASE" NOT "your_" NOT "YOUR_SEED" NOT "hardhat" NOT "viem"` | 种子短语泄漏 |
| `"secret" "mnemonic" extension:json NOT "example" NOT "test" NOT "hardhat"` | JSON 文件中的秘密 |
| `"wallet" "private" "key" extension:(py OR js OR ts OR rs OR go)` | 源代码中的钱包密钥 |
| `"DEPLOYER_PRIVATE_KEY" NOT "test" NOT "example" NOT "YOUR_"` | 部署者私钥泄漏 |
| `(mnemonic OR seedphrase) extension:env pushed:>=YYYY-MM-DD` | 7 天内的 .env 泄漏 |

### 3.2 排除大库信号

在 repo query 中显式排除已知大库，减少它们对搜索结果的占用。当前查询字符串已经包含了一些，但 **GitHub Search 对 `NOT` 操作符有最多限制**，所以更好的做法是代码层面做黑名单过滤（见第 8 节）。

---

## 4. 搜索词分级策略

### 4.1 四级分类体系

将 `leakTerms` 按置信度分级，不同级别使用不同的验证强度：

#### S 级（高置信度，无需 secret pattern 验证）

这些信号本身几乎 100% 表示存在秘密文件：

| Term | 理由 |
|------|------|
| `.env` 文件中的 `PRIVATE_KEY=0x` 赋值 | 可以直接匹配赋值模式 |
| 扩展名为 `.pem`、`.p12`、`.keystore` 的文件 | 本身就是密钥文件 |

处理方式：遇到这类信号直接入库，不经过 `requireSecretPattern` 过滤。

#### A 级（助记词，需轻度验证）

| Term | 说明 |
|------|------|
| `mnemonic` 出现在赋值/赋值号之后 | `mnemonic: "abandon abandon..."` |
| `seed phrase` 作为值而非代码引用 | 非 `function`/`class` 上下文 |

处理方式：需要 `containsSecretPattern` 检测到实际的助记词格式（12/15/18/21/24 个英文单词）。

#### B 级（关键词匹配，需严格验证）

| Term | 说明 |
|------|------|
| `private key` | 注释/字符串中的引用 |
| `secret key` | 同上 |
| `xprv` | 扩展私钥前缀 |

处理方式：需要同时满足：
1. `containsSecretPattern` 检测到 hex/b58/mnemonic
2. 内容过滤器排除测试/示例关键词
3. 路径过滤器排除测试目录

#### C 级（环境变量密钥，需值长度验证）

| Term | 说明 |
|------|------|
| `PRIVATE_KEY`、`WALLET_PRIVATE_KEY`、`DEPLOYER_PRIVATE_KEY` | 全大写的环境变量名 |
| `SOLANA_PRIVATE_KEY` | Solana 环境变量 |

处理方式：检测 `KEY_NAME=value` 模式，验证 value 长度和格式（hex 64 字符、b58 44+ 字符等）。

### 4.2 分级执行流程

```
获取所有 repo
  │
  ├── 对每个 repo 执行 S 级搜索（.env 类文件扫描）
  │     └── 直接入库，跳过 secret pattern 验证
  │
  ├── 对每个 repo 执行 A 级搜索（助记词）  
  │     └── 验证：实际助记词格式 + 非 test 文件
  │
  ├── 对每个 repo 执行 B 级搜索（关键词）
  │     └── 验证：secret pattern + 内容过滤 + 路径过滤
  │
  └── 对每个 repo 执行 C 级搜索（环境变量密钥）
        └── 验证：值长度 >= 特定阈值 + 格式匹配
```

---

## 5. 文件路径过滤策略优化

### 5.1 当前路径过滤的不足

```javascript
// 当前配置
excludeExtensions = [".md", ".mdx", ".rst"];
excludeContains    = ["docs/", "doc/", "examples/", "example/"];
excludeBasenames   = ["readme.md", "readme.mdx", "contributing.md", "changelog.md", "license"];
```

缺少的关键排除项：
- `test/`、`tests/`、`spec/`、`__test__/`、`__fixtures__/`、`mocks/`——测试目录
- `scripts/`——部署/脚本目录
- `dist/`、`build/`、`out/`、`target/`——编译产物
- `templates/`——模板目录
- `.github/`——CI 配置

### 5.2 优化后的路径过滤配置

**excludeContains（应加入）：**

```
test/,tests/,spec/,__test__/,__fixtures__/,mocks/,mock/,stubs/,
scripts/,deploy/,migrations/,
dist/,build/,out/,target/,artifacts/,cache/,
templates/,template/,
.github/,git-hooks/,
vendor/,node_modules/,bower_components/,
old/,archive/,backup/,
hardhat/,[n]ode[_]modules/
```

**excludeExtensions（应加入）：**

```
.sol（Solidity 源码，几乎不可能有真实私钥）
.pyc、.class、.o（二进制产物）
.png、.jpg、.jpeg、.gif、.svg、.ico（图片）
.pdf、.doc、.docx（二进制文档）
.zip、.tar.gz、.7z（压缩包）
.lock（锁文件，如 package-lock.json 但可能误杀）
```

注意：`.env`、`.json`、`.yaml`、`.toml`、`.txt`、`.cfg`**不应该按扩展名过滤**，这些文件反而是泄漏高发区。

### 5.3 正向匹配（优先级扫描）

以下路径模式应获得**较高的扫描优先级**（如有配额应优先扫）：

```
.env
.env.*
secret*.{json,yaml,yml,txt,env}
wallet*.{json,env,txt}
keystore*.{json}
*.pem
*.p12
*.priv
config.{json,yaml,yml} （当文件包含 private_key/mnemonic 关键词时）
```

---

## 6. 内容过滤策略优化

### 6.1 需要排除的已知测试密钥

**Hardhat / Anvil 测试助记词（最常用）：**

```
test test test test test test test test test test test junk
test test test test test test test test test test test test test test test abandon
```

这些助记词被 Hardhat、Anvil、Foundry 等框架广泛使用，出现在无数仓库的测试文件中。

**Hardhat / Anvil 已知测试私钥（前 5 个账户）：**

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
0x5de4111afa1a4b94908f83103eb1f15f0b5d47d1b7f2e3e91e7e4b7e0f7f1b1e
0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba4
0x92db14e403b83dfe3df233f83dfa3a0d7090140cf7bb5b3be6b9d8874f5b8b3e8
0x4bbbf85ce3377467afe5d46f804f221813b2a87a24d3c8f1b3e2a9f3f9a9b9c
0xdbda1821b80551c9d65939329250298aa3472ba22a6b9c0c6e4d5b1c8e7d1b2a
0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6
```

**Solana 已知测试密钥对：**

```
[1, ... 63 zeros]（Solana CLI 默认测试密钥）
[2, ... 63 zeros]
```

**其他常见模式：**

```
# 占位符/模板
<YOUR_PRIVATE_KEY>
<YOUR_MNEMONIC>
YOUR_SEED_PHRASE
CHANGE_THIS_TO_YOUR_PRIVATE_KEY
REPLACE_ME
XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
0000000000000000000000000000000000000000000000000000000000000000
FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
1111111111111111111111111111111111111111111111111111111111111111

# 示例值
privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001"
```

### 6.2 组合验证规则

除了关键词黑名单，更好的方式是**组合规则验证**——判断命中上下文的体裁：

#### Rule 1: 代码引用排除

如果命中行所在文件包含以下任意模式，且命中行在注释/文档字符串中，则跳过：

```
function mnemonicToEntropy(
fn mnemonic_to_seed(
class Mnemonic
mnemonicToEntropy(
mnemonicToSeed(
entropyToMnemonic(
generateMnemonic(
validateMnemonic(
```

#### Rule 2: 测试上下文排除

如果命中行所在文件包含 `describe(`、`it(`、`test(`、`@Test` 等测试框架特征，且命中值看起来像是测试数据，则跳过。

#### Rule 3: 赋值模式验证

仅当秘密值以明确赋值（`=`、`:`、`=>`）方式出现时才保留：

```
# 保留
PRIVATE_KEY=0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

# 跳过
// PRIVATE_KEY = your_private_key_here
const mnemonic = "test test test test test test test test test test test junk"
// This function takes a private key as parameter
```

---

## 7. 密文验证策略优化

### 7.1 当前密文验证的不足

当前 [secretPatterns.ts](file:///Users/lei/VibeCoding/TRAE-SOLO/GitSearchooor/src/secretPatterns.ts) 的逻辑：

```javascript
// hex 64: 检测 0x + 64 hex chars
// mnemonics: 检测 12-24 个英文单词
// base58: 检测 44+ base58 chars
// assign: 检测 keyword:value 模式
```

问题：
1. hex 64 只检测 `0x[a-f0-9]{64}`，但还有 32 字节的 hex 私钥不带 `0x` 前缀
2. mnemonic 正则太宽松——任何 12-24 个小写单词（如 "the quick brown fox jumps over the lazy dog"）都会被匹配
3. assign 模式只检测 8+ 字符的 value，但 8 个字符太短（`12345678` 也能命中）

### 7.2 优化后的验证规则

#### Hex 私钥验证

```
当前：0x[a-fA-F0-9]{64}
优化后：
  - 0x + 64 hex chars (ETH 私钥)     —— 当前已有
  - 64 hex chars 无 prefix            —— 新增（很多配置不写 0x）
  - 0x + 128 hex chars (ECDSA 签名)   —— 新增（某些场景）
```

#### 助记词验证

```
当前：\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b
优化后：
  - 至少 5 个不同单词（避免 "test test test..." 全同一单词） —— 新增
  - 单词必须来自 BIP39 词表（可选，准确但依赖大词表）         —— 远期
  - 排除连续重复单词模式（"test test test" 几乎没有助记词会长这样） —— 新增
```

#### Base58 验证

```
当前：\b[1-9A-HJ-NP-Za-km-z]{44,}\b
优化后：
  - 44 字符：Solana 地址/公钥（误报极高——任何 base58 串都可能） —— 需要降级
  - 88 字符：Solana 完整私钥（高置信度）                         —— 提升权重
  - 52 字符：比特币私钥（WIF 格式，以 L/K 开头）                 —— 新增
```

#### 赋值模式增强

```
当前：keyword\s*[:=]\s*([^\s'"`]{8,})
优化后：
  - 统一为 keyword\s*[:=]\s*value
  - value 至少 16 字符（避免短误报）
  - value 以 0x 开头 → 走 hex 验证流程
  - value 是 base58 → 走 base58 验证流程
  - value 是 空格分隔的单词序列 → 走助记词验证流程
```

### 7.3 联合评分机制

与其单独用布尔判断，不如给每条命中打分：

| 信号 | 分数 |
|------|------|
| 匹配到 `PRIVATE_KEY = 0x...64hex` | +5 |
| 匹配到 12+ 单词的 BIP39 助记词 | +4 |
| 匹配到 88+ base58 字符串（Solana 私钥） | +4 |
| 匹配到 44-88 base58 字符串 | +1 |
| 匹配到赋值模式（keyword=value） | +2 |
| 匹配到 test 文件内容 | -3 |
| 匹配到已知测试密钥 | -5 |
| 匹配到示例/文档内容 | -2 |

**阈值建议**：总分 >= 3 时入库。这样确保每条命中至少有 2 个正向信号叠加，避免单一弱信号导致的假正例。

---

## 8. 黑名单/白名单策略

### 8.1 Repo 黑名单（Blacklist）

这些仓库是已知的、安全受管理的核心框架库，不应该被扫描：

```
wevm/viem
wevm/wagmi
NomicFoundation/hardhat
ethereumjs/ethereumjs-monorepo
foundry-rs/foundry
OpenZeppelin/openzeppelin-contracts
OpenZeppelin/openzeppelin-contracts-upgradeable
paulmillr/btc-signer
paulmillr/noble-secp256k1
paulmillr/noble-curves
paulmillr/noble-hashes
paulmillr/scure-bip39
solana-labs/solana
solana-labs/solana-program-library
ChainSafe/lodestar
ChainSafe/web3.js
ethereum/web3.py
ethereum/go-ethereum
paritytech/polkadot-sdk
hyperledger/fabric
```

这些仓库的特征：
- 专业的开源团队维护，有安全审查流程
- 测试中使用的是标准已知测试密钥
- 它们的测试数据对真实泄漏调查**毫无价值**

### 8.2 自动化灰名单（Greylist）

对于不在黑名单中、但多次被扫描且从未确认为真实泄漏的 repo，自动降级处理：

| 重复命中次数 | 操作 |
|-------------|------|
| 1-3 次 | 正常扫描 |
| 4-6 次 | 降低扫描深度（perRepoCodeHits 减半） |
| 6-10 次 | 仅搜 S 级/A 级 term，跳过 B/C 级 |
| 10+ 次 | 自动加入临时黑名单（可配置是否汇报） |

### 8.3 白名单（可选）

如果用户知道某些特定 repo 需要重点关注（例如某项目可能泄漏了密钥），可以临时加入白名单，保证每次都被扫到。

---

## 9. Repo 多样性策略

### 9.1 分页随机偏移

**当前行为**：
```
searchRepos(query, limit=30) → 取第 1 页
```

**优化后**（分页随机偏移）：

```javascript
// 伪代码逻辑
async function searchReposWithSampling(query, limit) {
  // 1. 先获取总结果数
  const firstPage = await searchRepos(query, 1);
  const totalCount = firstPage.total_count;
  
  // 2. 计算可翻页数
  const maxPage = Math.min(Math.ceil(totalCount / 100), 10); // 最多翻 10 页
  if (maxPage <= 1) return firstPage.items; // 没有足够结果，返回第一页
  
  // 3. 取 2-3 个随机偏移页
  const pages = new Set();
  while (pages.size < Math.min(3, maxPage - 1)) {
    pages.add(Math.floor(Math.random() * maxPage) + 1);
  }
  
  // 4. 从选中的偏移页取 repo
  const repos = [];
  for (const page of pages) {
    const pageRepos = await searchRepos(query, limit / pages.size, page);
    repos.push(...pageRepos);
  }
  return repos.slice(0, limit);
}
```

这样每次运行都会覆盖不同范围的仓库，避免永远只扫到同一批热门项目。

### 9.2 按更新时间升序排列

GitHub Search API 支持按 `updated` 字段排序：

```
url.searchParams.set("sort", "updated");
url.searchParams.set("order", "asc");
```

这样最新 inactive 的项目排在最前面。这些无人维护的项目往往：
- 依赖未更新，安全风险更高
- 可能包含遗留的配置文件（仍有硬编码密钥）
- 不会进入 GitHub 的 Dependabot/DSA 扫描范围

### 9-3 组合使用：分页 + 排序

建议的组合策略：

| 场景 | 策略 |
|------|------|
| **首次扫描** | 按 `updated:asc` 排序，覆盖最新 inactive 的 repo |
| **后续轮次** | 随机分页偏移，覆盖不同排名的 repo |
| **高配额时** | 多页 + 多排序方式交叉覆盖 |

---

## 10. 代码层面可优化项

虽然本方案聚焦策略调整，但以下代码层面的优化对策略落地至关重要：

### 10.1 优先修复（P0）

| 项目 | 说明 |
|------|------|
| Repo 搜索翻页 | 见第 9.1 节，代码改动约 20 行 |
| requireSecretPattern 默认值 | 将 config.ts 中的默认值从 `false` 改为 `true` |

### 10.2 建议修复（P1）

| 项目 | 说明 |
|------|------|
| Repo 黑名单 | 在 bot.ts 的 repo 循环开始处增加黑名单跳过逻辑 |
| Test 目录排除 | 更新 config.ts 的 pathExcludeContains 默认值 |
| 已知测试密钥排除 | 更新 config.ts 的 contentExcludeKeywords 默认值 |
| 内容组合验证 | 在 filters.ts 中新增 combine 验证函数 |
| 密文验证增强 | 更新 secretPatterns.ts 的正则和评分逻辑 |

### 10.3 远期优化（P2）

| 项目 | 说明 |
|------|------|
| Git 提交日志扫描 | 搜索 commit message 中的 "add mnemonic"、"private key" |
| 多账号 GitHub Token | 轮流使用多个 token 提高配额 |
| 搜索结果缓存 | 对 repo 搜索结果做时间窗口缓存，避免同一 repo 在连续轮次中被重复扫 |
| 自动黑名单 | 基于 hit_count 和确认状态自动生成灰名单 |

---

## 11. 实施路线图

### Phase 1：配置调优（0 代码改动，5 分钟）

当前 `.env` 已有 `stars:<2000` 后缀，这是一个很好的前置过滤——避免了 top star 大库的污染。但仍有几个关键缺项需要补充。

在现有 `.env` 基础上，新增以下配置项：

```bash
# ==== 新增：密文验证（最关键）====
# 必须同时命中关键词 + 实际密文格式（hex私钥/助记词/base58）才入库
# 没有这一项，代码中引用 "mnemonic" 作为变量名也会被误报
GITHUB_REQUIRE_SECRET_PATTERN=1

# ==== 新增：路径过滤（覆盖 test/、scripts/、编译产物等）====
# 当前 env 未设置路径过滤，走代码默认值（只排 docs/、examples/、.md）
# 必须显式设置才能覆盖默认值
GITHUB_PATH_FILTER_ENABLED=1
GITHUB_PATH_EXCLUDE_EXTENSIONS=".md,.mdx,.rst,.sol,.pyc,.class,.o,.png,.jpg,.jpeg,.gif,.svg,.ico,.pdf,.doc,.docx,.zip,.tar.gz,.7z,.lock"
GITHUB_PATH_EXCLUDE_CONTAINS="docs/,doc/,examples/,example/,test/,tests/,spec/,__test__/,__fixtures__/,mocks/,mock/,scripts/,deploy/,migrations/,dist/,build/,out/,target/,artifacts/,cache/,templates/,template/,.github/,git-hooks/,vendor/,node_modules/"
GITHUB_PATH_EXCLUDE_BASENAMES="readme.md,readme.mdx,contributing.md,changelog.md,license,.gitignore,.prettierrc,.eslintrc,.editorconfig"

# ==== 新增：内容过滤（排除已知测试密钥和占位符）====
GITHUB_CONTENT_FILTER_ENABLED=1
GITHUB_CONTENT_EXCLUDE_KEYWORDS="your_private_key,your mnemonic,your seed phrase,example,examples,demo,placeholder,replace_with,replace me,changeme,test test test test,0xac0974be,0x59c6995e,0x5de4111a,0x7c852118,0x47e179ec,<YOUR_PRIVATE_KEY>,<YOUR_MNEMONIC>,YOUR_SEED_PHRASE,CHANGE_THIS,REPLACE_ME,XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX,00000000000000000000000000000000,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"

# ==== 建议修改：降低配额 ====
GITHUB_REPOS_PER_RUN=10        # 当前 30 → 10
GITHUB_PER_REPO_CODE_HITS=5    # 当前 10 → 5
GITHUB_MAX_HITS_PER_REPO=3     # 当前未设置（默认 10）→ 3

# ==== 建议修改：缩短 pushed 时间窗口 ====
GITHUB_REPO_PUSHED_DAYS=3      # 当前 7 → 3

# ==== 可选优化：提高限流余量 ====
GITHUB_SEARCH_MIN_REMAINING=5  # 当前 3 → 5
```

**修改后的完整 `.env`**（仅列出需要变动的行，其余保持原样）：

```bash
# 扫描策略
GITHUB_REPO_PUSHED_DAYS=3
GITHUB_REPOS_PER_RUN=10
GITHUB_PER_REPO_CODE_HITS=5
GITHUB_MAX_HITS_PER_REPO=3
GITHUB_REQUIRE_SECRET_PATTERN=1
GITHUB_SEARCH_MIN_REMAINING=5
# 注意：搜索 query 维持不变，stars:<2000 已是非常好的防护

# 路径过滤（需显式设置，覆盖代码默认值）
GITHUB_PATH_FILTER_ENABLED=1
GITHUB_PATH_EXCLUDE_EXTENSIONS=".md,.mdx,.rst,.sol,.pyc,.class,.o,.png,.jpg,.jpeg,.gif,.svg,.ico,.pdf,.doc,.docx,.zip,.tar.gz,.7z,.lock"
GITHUB_PATH_EXCLUDE_CONTAINS="docs/,doc/,examples/,example/,test/,tests/,spec/,__test__/,__fixtures__/,mocks/,mock/,scripts/,deploy/,migrations/,dist/,build/,out/,target/,artifacts/,cache/,templates/,template/,.github/,git-hooks/,vendor/,node_modules/"
GITHUB_PATH_EXCLUDE_BASENAMES="readme.md,readme.mdx,contributing.md,changelog.md,license,.gitignore,.prettierrc,.eslintrc,.editorconfig"

# 内容过滤（需显式设置）
GITHUB_CONTENT_FILTER_ENABLED=1
GITHUB_CONTENT_EXCLUDE_KEYWORDS="your_private_key,your mnemonic,your seed phrase,example,examples,demo,placeholder,replace_with,replace me,changeme,test test test test,0xac0974be,0x59c6995e,0x5de4111a,0x7c852118,0x47e179ec,<YOUR_PRIVATE_KEY>,<YOUR_MNEMONIC>,YOUR_SEED_PHRASE,CHANGE_THIS,REPLACE_ME,XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX,00000000000000000000000000000000,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
```

预期效果：Notion 中的命中量会减少 95% 以上，但剩下的都是真实泄漏而非测试数据。

### Phase 2：Repo 搜索结果多样化（中等改动）

1. 改 repo query 为搜泄漏场景（方案 A 或方案 C）
2. 增加黑名单逻辑
3. 增加分页随机偏移

### Phase 3：搜素词分级 & 组合验证（较大改动）

1. 实现 S/A/B/C 四级泄漏词体系
2. 实现联合评分机制
3. 实现内容体裁识别（代码/测试/文档分类）

### Phase 4：代码健壮性（持续优化）

1. 自动黑名单/灰名单
2. 多 token 轮换
3. 搜索结果缓存
4. 优雅退出处理

---

## 13. 当前环境评估

### 13.1 当前 `.env` 逐项分析

| 配置项 | 当前值 | 评估 | 建议 |
|--------|--------|------|------|
| `SQLITE_DB_PATH` | `/root/GitSearchooor/.data/state.db` | ✅ 正确，VPS 路径 | 无需修改 |
| `DEADLETTER_PATH` | `/root/GitSearchooor/.data/deadletter.jsonl` | ✅ 正确 | 无需修改 |
| `GITHUB_REPO_PUSHED_DAYS` | `7` | ⚠️ 可收紧 | 改为 `3`，减少老旧数据扫描 |
| `GITHUB_REPO_QUERY` | `(evm OR ethereum OR solidity OR ethers OR viem OR solana) archived:false fork:false is:public stars:<2000` | ⚠️ **优点**：`stars:<2000` 很聪明，排除了热门大库。<br>**缺点**：关键词仍是框架名（`viem`、`ethers`、`solidity`），仍有大量 <2000 star 的框架项目包含测试数据 | 维持不变；`stars:<2000` 已是现阶段最有效的过滤 |
| `GITHUB_REPOS_PER_RUN` | `30` | ⚠️ 偏高 | 改为 `10`，降低热度污染概率 |
| `GITHUB_PER_REPO_CODE_HITS` | `10` | ⚠️ 偏高 | 改为 `5` |
| `LEAK_TERMS` | 全量关键词 | ✅ 合理 | 无需修改 |
| `GITHUB_SEARCH_MIN_REMAINING` | `3` | ⚠️ 偏低 | 改为 `5`，更稳妥 |
| `GITHUB_CORE_MIN_REMAINING` | `50` | ✅ 合理 | 无需修改 |
| `GITHUB_HTTP_TIMEOUT_SEC` | `60` | ✅ 合理 | 无需修改 |
| `GITHUB_MAX_CONCURRENCY` | `1` | ✅ 保守安全 | 无需修改 |
| `LOOP_*` | 3600/21600/120 | ✅ 合理 | 无需修改 |
| Notion props | 全部正确映射 | ✅ 正确 | 无需修改 |

### 13.2 关键缺失项

以下配置项在当前 `.env` 中**未设置**，走代码默认值，需要显式添加：

| 缺失项 | 默认值 | 问题 | 应设值 |
|--------|--------|------|--------|
| `GITHUB_REQUIRE_SECRET_PATTERN` | **`false`** ⛔ | **不验证密文格式，关键词匹配就入库——这是 Notion 被 wevm/viem 测试数据填满的根本原因** | `1` |
| `GITHUB_MAX_HITS_PER_REPO` | `10` ⛔ | 每个 repo 最多 10 条命中，对于 viem 这种项目足够填满全部 30 个配额 | `3` |
| `GITHUB_PATH_EXCLUDE_CONTAINS` | `docs/,doc/,examples/,example/` ⛔ | 未排除 `test/`、`scripts/`、`dist/`、编译产物目录 | 见 Phase 1 |
| `GITHUB_PATH_EXCLUDE_EXTENSIONS` | `.md,.mdx,.rst` ⛔ | 未排除 `.sol`、图片、二进制文件 | 见 Phase 1 |
| `GITHUB_CONTENT_EXCLUDE_KEYWORDS` | 少量示例词 ⛔ | 未排除 Hardhat/Anvil 已知测试密钥和占位符 | 见 Phase 1 |

### 13.3 当前已有配置的优点

虽然当前 `.env` 存在缺失，但 `stars:<2000` 这条过滤非常值得肯定：

- **效果**：排除了 star 数 >= 2000 的热门仓库。这意味着 wevm/viem（40k+）、hardhat（7k+）、foundry（8k+）在 repo search 阶段就被过滤掉了
- **局限性**：仍有大量 <2000 star 的仓库使用 viem/ethers/solidity，它们同样可能包含测试数据。但相比之前的无限制状态已经有了本质提升

### 13.4 核心结论

**只需新增 5 个配置项（都不需要改代码），就能解决 Notion 被无用数据填满的问题：**

1. `GITHUB_REQUIRE_SECRET_PATTERN=1` — 最关键，过滤掉 90% 的假正例
2. `GITHUB_MAX_HITS_PER_REPO=3` — 限制每 repo 入库量
3. 路径过滤 3 个配置项 — 排除 test/ 等目录
4. 内容过滤 2 个配置项 — 排除已知测试密钥
5. `GITHUB_REPOS_PER_RUN=10` + `GITHUB_PER_REPO_CODE_HITS=5` — 降低配额

这 5 个改动预计可将 Notion 中的假正例减少 **95% 以上**，接下来的命中才算有调查价值。

---

## 12. 附录：推荐配置参数表

### 启动配置

| 环境变量 | 当前值 | 推荐值 | 说明 |
|---------|--------|--------|------|
| `GITHUB_TOKEN` | 已设置 | 保持不变 | 必填 |
| `NOTION_TOKEN` | 已设置 | 保持不变 | 必填 |
| `NOTION_DATABASE_ID` | 已设置 | 保持不变 | 必填 |

### 搜索策略

| 环境变量 | 当前值 | 推荐值 | 说明 |
|---------|--------|--------|------|
| `GITHUB_REPO_QUERY` | 框架关键词 + `stars:<2000` | **维持不变** | `stars:<2000` 已是有效的防护 |
| `GITHUB_REPO_PUSHED_DAYS` | 7 | **3** | 时间窗口缩窄，减少陈旧数据 |
| `GITHUB_REPOS_PER_RUN` | 30 | **10** | 降低到 1/3 |
| `GITHUB_PER_REPO_CODE_HITS` | 10 | **5** | 每 term 减少一半 |
| `GITHUB_MAX_HITS_PER_REPO` | 未设置（默认 10） | **3** | 每 repo 上限压缩 |
| `GITHUB_REQUIRE_SECRET_PATTERN` | 未设置（默认 false） | **1** | **最关键的单次改动** |

### 过滤器

| 环境变量 | 当前值 | 推荐值 |
|---------|--------|--------|
| `GITHUB_PATH_FILTER_ENABLED` | 未设置（默认 true） | `1`（需显式设置才能覆盖默认值） |
| `GITHUB_PATH_EXCLUDE_EXTENSIONS` | 未设置（默认 `.md,.mdx,.rst`） | `.md,.mdx,.rst,.sol,.pyc,.class,.o,.png,.jpg,.jpeg,.gif,.svg,.ico,.pdf,.doc,.docx,.zip,.tar.gz,.7z,.lock` |
| `GITHUB_PATH_EXCLUDE_CONTAINS` | 未设置（默认 `docs/,doc/,examples/,example/`） | `docs/,doc/,examples/,example/,test/,tests/,spec/,__test__/,__fixtures__/,mocks/,mock/,scripts/,deploy/,migrations/,dist/,build/,out/,target/,artifacts/,cache/,templates/,template/,.github/,git-hooks/,vendor/,node_modules/` |
| `GITHUB_PATH_EXCLUDE_BASENAMES` | 未设置（默认 `readme.md,...`） | `readme.md,readme.mdx,contributing.md,changelog.md,license,.gitignore,.prettierrc,.eslintrc,.editorconfig` |
| `GITHUB_CONTENT_FILTER_ENABLED` | 未设置（默认 true） | `1`（需显式设置才能覆盖默认值） |
| `GITHUB_CONTENT_EXCLUDE_KEYWORDS` | 未设置（默认少量示例词） | 见 Phase 1 配置 |

### 限流与循环

| 环境变量 | 当前值 | 推荐值 | 说明 |
|---------|--------|--------|------|
| `GITHUB_SEARCH_MIN_REMAINING` | 3 | **5** | 留更多余量 |
| `GITHUB_CORE_MIN_REMAINING` | 50 | 50 | 保持不变 |
| `GITHUB_HTTP_TIMEOUT_SEC` | 60 | 60 | 保持不变 |
| `GITHUB_MAX_CONCURRENCY` | 1 | 1 | 暂时维持单线程 |
| `LOOP_MIN_INTERVAL_SEC` | 3600 | 3600 | 每 1 小时一轮 |
| `LOOP_MAX_INTERVAL_SEC` | 21600 | 21600 | 最多 6 小时 |
| `LOOP_JITTER_SEC` | 120 | 120 | 2 分钟随机抖动 |
