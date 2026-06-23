import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export type NotionPropertyKey =
  | "title"
  | "repo_url"
  | "file_url"
  | "file_path"
  | "term"
  | "snippet"
  | "ecosystem"
  | "blob_sha"
  | "status"
  | "first_seen"
  | "last_seen"
  | "hit_count"
  | "dedup_key"
  | "notes"
  | "tags";

export type Config = {
  paths: {
    sqliteDbPath: string;
    deadletterPath: string;
  };
  github: {
    token: string;
    apiBaseUrl: string;
    repoQuery: string;
    repoPushedDays: number;
    reposPerRun: number;
    perRepoCodeHits: number;
    maxHitsPerRepo: number;
    dependencyFiles: string[];
    ethereumMarkers: string[];
    solanaMarkers: string[];
    leakTerms: string[];
    pathFilter: {
      enabled: boolean;
      excludeExtensions: string[];
      excludeContains: string[];
      excludeBasenames: string[];
    };
    contentFilter: {
      enabled: boolean;
      excludeKeywords: string[];
    };
    requireSecretPattern: boolean;
    secretPattern: {
      base58MinLen: number;
      enableMnemonic: boolean;
      enableBase58: boolean;
    };
    repoBlacklist: string[];
    repoSearchPageLimit: number;
    httpTimeoutSec: number;
    maxConcurrency: number;
    searchMinRemaining: number;
    coreMinRemaining: number;
    userAgent: string;
  };
  notion: {
    token: string;
    databaseId: string;
    defaultStatus: string;
    validateEachLoop: boolean;
    backfillMissingPage: boolean;
    props: Record<NotionPropertyKey, string>;
  };
  loop: {
    minIntervalSec: number;
    maxIntervalSec: number;
    jitterSec: number;
  };
};

function env(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  return v;
}

function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (!v) return fallback;
  const x = Number.parseInt(v, 10);
  return Number.isFinite(x) ? x : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = env(name);
  if (!v) return fallback;
  const x = Number.parseFloat(v);
  return Number.isFinite(x) ? x : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = env(name);
  if (!v) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

function splitCsv(s: string): string[] {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function loadEnvFile(envFilePath: string): void {
  const p = path.resolve(envFilePath);
  if (!fs.existsSync(p)) return;
  if (!fs.statSync(p).isFile()) return;
  dotenv.config({ path: p, override: false });
}

export function loadConfig(): Config {
  const sqliteDbPath = env("SQLITE_DB_PATH") ?? ".data/state.db";
  const deadletterPath = env("DEADLETTER_PATH") ?? ".data/deadletter.jsonl";

  const githubToken = env("GITHUB_TOKEN") ?? "";
  const apiBaseUrl = env("GITHUB_API_BASE_URL") ?? "https://api.github.com";
  const repoQuery =
    env("GITHUB_REPO_QUERY") ??
    '(evm OR ethereum OR solidity OR solc OR foundry OR forge OR cast OR hardhat OR truffle OR ethers OR viem OR wagmi OR metamask OR openzeppelin OR uniswap OR aave OR chainlink OR flashbots OR mev OR erc20 OR erc721 OR erc1155) OR (solana OR "@solana/web3.js" OR solana-sdk OR solana_sdk:: OR anchor OR anchor-lang OR anchor_lang:: OR spl-token OR token-2022 OR raydium OR jupiter) archived:false fork:false is:public';

  const dependencyFiles = splitCsv(
    env("DEPENDENCY_FILES") ?? "package.json,requirements.txt,pyproject.toml,Cargo.toml,go.mod"
  );
  const ethereumMarkers = splitCsv(
    env("ETHEREUM_MARKERS") ?? "ethers,viem,web3,web3.py,go-ethereum,ethers::,alloy"
  );
  const solanaMarkers = splitCsv(
    env("SOLANA_MARKERS") ??
      "@solana/web3.js,solana-sdk,solana_sdk::,anchor-lang,anchor_lang::,anchorpy,solders"
  );
  const leakTerms = splitCsv(
    env("LEAK_TERMS") ??
      "mnemonic,seed phrase,seedphrase,private key,secret key,xprv,solana secret key,PRIVATE_KEY,SECRET_KEY,MNEMONIC,SEED_PHRASE,WALLET_PRIVATE_KEY,DEPLOYER_PRIVATE_KEY,OWNER_PRIVATE_KEY,ADMIN_PRIVATE_KEY,SOLANA_PRIVATE_KEY"
  );

  const maxHitsPerRepo = envInt("GITHUB_MAX_HITS_PER_REPO", 5);
  const pathFilterEnabled = envBool("GITHUB_PATH_FILTER_ENABLED", true);
  const pathExcludeExtensions = splitCsv(env("GITHUB_PATH_EXCLUDE_EXTENSIONS") ?? ".md,.mdx,.rst,.sol,.pyc,.class,.o,.png,.jpg,.jpeg,.gif,.svg,.ico,.pdf,.doc,.docx,.zip,.tar.gz,.7z,.lock");
  const pathExcludeContains = splitCsv(env("GITHUB_PATH_EXCLUDE_CONTAINS") ?? "docs/,doc/,examples/,example/,test/,tests/,spec/,__test__/,__fixtures__/,mocks/,mock/,scripts/,deploy/,migrations/,dist/,build/,out/,target/,artifacts/,cache/,templates/,template/,.github/,git-hooks/,vendor/,node_modules/");
  const pathExcludeBasenames = splitCsv(
    env("GITHUB_PATH_EXCLUDE_BASENAMES") ?? "readme.md,readme.mdx,contributing.md,changelog.md,license,.gitignore,.prettierrc,.eslintrc,.editorconfig"
  );
  const contentFilterEnabled = envBool("GITHUB_CONTENT_FILTER_ENABLED", true);
  const contentExcludeKeywords = splitCsv(
    env("GITHUB_CONTENT_EXCLUDE_KEYWORDS") ??
      "your_private_key,your mnemonic,your seed phrase,example,examples,demo,placeholder,replace_with,replace me,changeme,test test test test,0xac0974be,0x59c6995e,0x5de4111a,0x7c852118,0x47e179ec,<YOUR_PRIVATE_KEY>,<YOUR_MNEMONIC>,YOUR_SEED_PHRASE,CHANGE_THIS,REPLACE_ME,XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX,00000000000000000000000000000000,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
  );
  const requireSecretPattern = envBool("GITHUB_REQUIRE_SECRET_PATTERN", true);
  const secretPatternBase58MinLen = envInt("GITHUB_SECRET_PATTERN_BASE58_MIN_LEN", 80);
  const secretPatternEnableMnemonic = envBool("GITHUB_SECRET_PATTERN_ENABLE_MNEMONIC", true);
  const secretPatternEnableBase58 = envBool("GITHUB_SECRET_PATTERN_ENABLE_BASE58", true);
  const repoBlacklist = splitCsv(
    env("GITHUB_REPO_BLACKLIST") ??
      "wevm/viem,wevm/wagmi,NomicFoundation/hardhat,ethereumjs/ethereumjs-monorepo,foundry-rs/foundry,OpenZeppelin/openzeppelin-contracts,OpenZeppelin/openzeppelin-contracts-upgradeable,paulmillr/btc-signer,paulmillr/noble-secp256k1,paulmillr/noble-curves,paulmillr/noble-hashes,paulmillr/scure-bip39,solana-labs/solana,solana-labs/solana-program-library,ChainSafe/lodestar,ChainSafe/web3.js,ethereum/web3.py,ethereum/go-ethereum,paritytech/polkadot-sdk,hyperledger/fabric"
  );
  const repoSearchPageLimit = envInt("GITHUB_REPO_SEARCH_PAGE_LIMIT", 5);

  const notionToken = env("NOTION_TOKEN") ?? "";
  const notionDatabaseId = env("NOTION_DATABASE_ID") ?? "";
  const notionDefaultStatus = env("NOTION_DEFAULT_STATUS") ?? "待复核";
  const validateEachLoop = envBool("NOTION_VALIDATE_EACH_LOOP", false);
  const backfillMissingPage = envBool("NOTION_BACKFILL_MISSING_PAGE", true);

  const props: Record<NotionPropertyKey, string> = {
    title: env("NOTION_PROP_TITLE") ?? "Title",
    repo_url: env("NOTION_PROP_REPO_URL") ?? "Repo URL",
    file_url: env("NOTION_PROP_FILE_URL") ?? "File URL",
    file_path: env("NOTION_PROP_FILE_PATH") ?? "File Path",
    term: env("NOTION_PROP_TERM") ?? "Term",
    snippet: env("NOTION_PROP_SNIPPET") ?? "Snippet (Masked)",
    ecosystem: env("NOTION_PROP_ECOSYSTEM") ?? "Ecosystem",
    blob_sha: env("NOTION_PROP_BLOB_SHA") ?? "Blob SHA",
    status: env("NOTION_PROP_STATUS") ?? "Status",
    first_seen: env("NOTION_PROP_FIRST_SEEN") ?? "First Seen",
    last_seen: env("NOTION_PROP_LAST_SEEN") ?? "Last Seen",
    hit_count: env("NOTION_PROP_HIT_COUNT") ?? "Hit Count",
    dedup_key: env("NOTION_PROP_DEDUP_KEY") ?? "Dedup Key",
    notes: env("NOTION_PROP_NOTES") ?? "Notes",
    tags: env("NOTION_PROP_TAGS") ?? "Tags"
  };

  return {
    paths: {
      sqliteDbPath,
      deadletterPath
    },
    github: {
      token: githubToken,
      apiBaseUrl,
      repoQuery,
      repoPushedDays: envInt("GITHUB_REPO_PUSHED_DAYS", 3),
      reposPerRun: envInt("GITHUB_REPOS_PER_RUN", 15),
      perRepoCodeHits: envInt("GITHUB_PER_REPO_CODE_HITS", 5),
      maxHitsPerRepo,
      dependencyFiles,
      ethereumMarkers,
      solanaMarkers,
      leakTerms,
      repoBlacklist,
      repoSearchPageLimit,
      pathFilter: {
        enabled: pathFilterEnabled,
        excludeExtensions: pathExcludeExtensions,
        excludeContains: pathExcludeContains,
        excludeBasenames: pathExcludeBasenames
      },
      contentFilter: {
        enabled: contentFilterEnabled,
        excludeKeywords: contentExcludeKeywords
      },
      requireSecretPattern,
      secretPattern: {
        base58MinLen: secretPatternBase58MinLen,
        enableMnemonic: secretPatternEnableMnemonic,
        enableBase58: secretPatternEnableBase58
      },
      httpTimeoutSec: envInt("GITHUB_HTTP_TIMEOUT_SEC", 60),
      maxConcurrency: envInt("GITHUB_MAX_CONCURRENCY", 1),
      searchMinRemaining: envInt("GITHUB_SEARCH_MIN_REMAINING", 3),
      coreMinRemaining: envInt("GITHUB_CORE_MIN_REMAINING", 50),
      userAgent: env("GITHUB_USER_AGENT") ?? "gitsearchooor/ts"
    },
    notion: {
      token: notionToken,
      databaseId: notionDatabaseId,
      defaultStatus: notionDefaultStatus,
      validateEachLoop,
      backfillMissingPage,
      props
    },
    loop: {
      minIntervalSec: envInt("LOOP_MIN_INTERVAL_SEC", 3600),
      maxIntervalSec: envInt("LOOP_MAX_INTERVAL_SEC", 21600),
      jitterSec: envFloat("LOOP_JITTER_SEC", 120)
    }
  };
}

export function redactedConfig(cfg: Config): object {
  return {
    ...cfg,
    github: { ...cfg.github, token: cfg.github.token ? "***" : "" },
    notion: { ...cfg.notion, token: cfg.notion.token ? "***" : "" }
  };
}
