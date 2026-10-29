# Pharos On-Chain Alert Bot

A focused, read-only ERC-20 large-transfer alert bot for Pharos Pacific Mainnet (chain ID 1672). A Cloudflare Cron scheduler polls contiguous bounded block ranges, commits cursor and event/outbox records durably in D1, and delivers owner-authorized alerts to Discord.

## Requirements

- Configurable token, exact minimum amount, optional sender and recipient, and confirmation delay.
- Real external delivery through Discord webhook with wait=true; the returned message ID is stored.
- Alert text includes network, chain ID, verified metadata, exact amount/raw value, both parties, block, transaction, explorer link, threshold, stable event ID, and detection mode.
- Deduplication uses the D1 primary key 1672:transactionHash:logIndex; delivered and ambiguous outcomes are never blindly resent.

## Foundation evidence

Official Pharos Chain MCP returned chain ID 1672 and exposed get_logs with a maximum inclusive window of 1,000 blocks. Default USDC has bytecode; live decimals() returned 6 and symbol() returned USDC. The deployed scheduler uses equivalent read-only JSON-RPC because interactive MCP is unavailable inside a Cloudflare Worker.

Default token: 0xC879C018dB60520F4355C26eD1a6D572cdAC1815. It is convenient, not trusted: every saved configuration verifies bytecode, decimals, and symbol.

## Secure channel setup

Create a dedicated Discord text channel, then use Edit Channel > Integrations > Webhooks > New Webhook. Never paste the URL into chat, source, screenshots, evidence, or the public form.

Save it directly as a Cloudflare secret:

    Set-Location "<project path>"
    npx wrangler secret put DISCORD_WEBHOOK_URL

Paste the URL only at Wrangler's hidden prompt. Save an owner bearer token similarly:

    npx wrangler secret put OWNER_TOKEN

The owner must explicitly authorize the destination before any demonstration.

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

No wallet, private key, signature, approval, contract deployment, blockchain transaction, or spending. Token symbol text is bounded/escaped and Discord mentions are disabled. Exactly-once delivery cannot be proven after an ambiguous webhook timeout, so the bot fails closed. SocialScan transaction links must be visually reverified for the final captured event.

## Reviewer flow

1. Inspect public status.
2. Enter the owner token locally and do not record it.
3. Click Save Configuration, then Start Monitor.
4. Observe timestamps and cursor progression.
5. Use a clearly labeled recent Historical backfill start block if waiting is impractical.
6. Confirm one Discord message, message ID, and transaction page.
7. Repeat the same range and verify no second delivery; raise threshold and verify exclusion; reload and verify persistence.
