---
name: pharos-onchain-alert-bot
description: Operate a read-only Pharos Pacific ERC-20 large-transfer monitor with durable Discord delivery.
---

# Workflow

1. Confirm Pharos Pacific Mainnet, chain ID 1672.
2. Validate ERC-20 address, bytecode, decimals and symbol through read-only calls.
3. Parse the threshold with BigInt and verified decimals.
4. Normalize optional sender and recipient.
5. Choose fresh monitoring or an explicitly labeled bounded historical backfill.
6. Save and start the server scheduler.
7. Process contiguous ranges of at most 1,000 confirmed blocks.
8. Decode real Transfer logs and apply threshold plus filters.
9. Use chain:transactionHash:logIndex as stable identity and enqueue atomically with cursor progress.
10. Deliver only to an owner-authorized secret destination. For Discord use wait=true, persist the message ID, honor rate limits, and never blindly resend DELIVERED or UNKNOWN_DELIVERY.
11. Verify message content and the explorer page.

# Limits

Read-only only. Never create wallets, request keys, sign, approve, deploy, broadcast, or spend. Historical backfill is not live detection. Ambiguous webhook delivery cannot be reconciled with a webhook alone and remains UNKNOWN_DELIVERY. Never claim real delivery until a human confirms the message.
