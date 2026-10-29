# Pharos On-Chain Alert Bot

A focused, read-only ERC-20 large-transfer alert bot for Pharos Pacific Mainnet (chain ID 1672). A Cloudflare Cron scheduler polls contiguous bounded block ranges, commits cursor and event/outbox records durably in D1, and delivers owner-authorized alerts to a private Telegram chat.

## Requirements

- Configurable token, exact minimum amount, optional sender and recipient, and confirmation delay.
- Real external delivery through Telegram Bot API sendMessage; the returned Telegram message ID is stored.
- Alert text includes network, chain ID, verified metadata, exact amount/raw value, both parties, block, transaction, explorer link, threshold, stable event ID, and detection mode.
- Deduplication uses the D1 primary key 1672:transactionHash:logIndex; delivered and ambiguous outcomes are never blindly resent.

## Foundation evidence

Official Pharos Chain MCP returned chain ID 1672 and exposed get_logs with a maximum inclusive window of 1,000 blocks. Default USDC has bytecode; live decimals() returned 6 and symbol() returned USDC. The deployed scheduler uses equivalent read-only JSON-RPC because interactive MCP is unavailable inside a Cloudflare Worker.

Default token: 0xC879C018dB60520F4355C26eD1a6D572cdAC1815. It is convenient, not trusted: every saved configuration verifies bytecode, decimals, and symbol.

## Secure Telegram channel setup

1. Open the verified @BotFather account in Telegram.
2. Send /newbot, choose a display name, then choose a unique username ending in bot.
3. BotFather returns a bot token. Never paste it into chat, source, a public form, screenshots, evidence, or the demo video.
4. Open the new bot's private chat and press Start (or send /start). The bot cannot send to a private chat until this is done.
5. Obtain the numeric chat ID without exposing the token:
   - Send any harmless message to the bot.
   - In a normal local PowerShell, place the token only into a hidden prompt and call getUpdates locally; read result.message.chat.id.
   - Do not copy the JSON response into chat or evidence because it may contain private profile data.
6. Store TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID through hidden local prompts using scripts/configure-telegram-secrets.ps1.
7. Enter the separate owner token in the deployed page only while operating it. Click Send Setup Test once. The endpoint is owner-protected and stores the returned Telegram message ID.
8. Only after the setup test is confirmed, use one explicitly labeled historical backfill for a recent real Transfer event.

The owner has authorized exactly one setup-test message and one real-event backfill alert to the configured private chat. No other destination or message is authorized.
## Polling and recovery

- Cron runs every minute independently of a browser.
- Fresh mode starts after the confirmed head. Historical mode requires an explicit recent block and is capped at 10,000 blocks.
- One successful call processes at most 1,000 contiguous blocks. Cursor advancement is in the same D1 batch as event/outbox writes.
- Source failure retains the cursor and records the failure.
- DETECTED to QUEUED to DELIVERING to DELIVERED.
- HTTP 429 honors bounded retry-after; 5xx has bounded retry; definite 4xx is REJECTED.
- Network timeout after possible acceptance is UNKNOWN_DELIVERY and is not blindly resent.
- Reconfiguration cannot recreate an existing event key.

## Local verification

    npm ci
    npm test
    npm run build

D1 setup/deployment is postponed until the owner authorizes/configures the real destination.

## Security and limitations

No wallet, private key, signature, approval, contract deployment, blockchain transaction, or spending. Token symbol text is bounded/escaped and no Telegram parse mode is enabled, so token metadata cannot create mentions or formatting. Exactly-once delivery cannot be proven after an ambiguous Telegram API timeout, so the bot fails closed. SocialScan transaction links must be visually reverified for the final captured event.

## Reviewer flow

1. Inspect public status.
2. Enter the owner token locally and do not record it.
3. Click Save Configuration, then Start Monitor.
4. Observe timestamps and cursor progression.
5. Use a clearly labeled recent Historical backfill start block if waiting is impractical.
6. Confirm one Telegram message, message ID, and transaction page.
7. Repeat the same range and verify no second delivery; raise threshold and verify exclusion; reload and verify persistence.



## Verified production demonstration

- Setup test: Telegram HTTP 200, message ID 4.
- Real-event historical backfill: 55.28 USDC at block 21620768, Telegram HTTP 200, message ID 5.
- Stable event ID: 1672:0x2eb69b3f25841c4fa7c121b8393c197f224efd2b9726678797af09a20e2e507b:0.
- Reprocessing produced zero new event/outbox rows; delivery remained one attempt and message ID 5.
- A 55.280001 USDC threshold excluded the 55.28 USDC event.
- Cloudflare Cron advanced the contiguous cursor after deployment/restart while D1 retained delivery state.
- Explorer link resolved to the transaction-detail page with the transaction hash present.
- Sanitized proof: evidence/v1-telegram-delivery.json.

