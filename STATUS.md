# Status

Updated: 2026-10-30 (Asia/Tehran)

## Completed
- Created the independent project without modifying the paused Docs MCP project.
- Inspected the official Pharos Chain MCP schemas once.
- Confirmed Pharos Pacific Mainnet chain ID 1672 and latest block 21621444 through a real read.
- Confirmed get_logs supports address/topics and inclusive ranges of at most 1,000 blocks.
- Confirmed no pre-authorized Telegram/Discord destination or webhook secret is available.
- Reused the verified Pharos PNG asset from an approved utility.

## In progress
Focused ERC-20 large-transfer monitor, durable D1 cursor/outbox, scheduler, owner gate, public reviewer UI, tests, and docs.

## External blocker
Real channel delivery requires the owner to authorize a Discord destination and save its webhook URL directly as Cloudflare secret DISCORD_WEBHOOK_URL. Never paste it into chat or evidence.

## Safety
Read-only blockchain access. No wallet, keys, signing, approvals, contracts, transactions, or spending.
