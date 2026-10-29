export const CHAIN_ID = 1672;
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function normalizeAddress(value, field = "address") {
  if (value == null || value === "") return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(field + " must be a 20-byte EVM address.");
  return value.toLowerCase();
}
export function parseUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Token decimals are invalid.");
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error("Threshold must be a non-negative decimal string.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Threshold has too many decimal places.");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}
export function formatUnits(raw, decimals) {
  const n = BigInt(raw), base = 10n ** BigInt(decimals);
  const fraction = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? (n / base) + "." + fraction : (n / base).toString();
}
export function decodeTransfer(log, metadata) {
  if (!Array.isArray(log?.topics) || log.topics.length < 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) throw new Error("Log is not an ERC-20 Transfer event.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(log.data || "")) throw new Error("Transfer amount is not one ABI word.");
  const txHash = String(log.transactionHash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new Error("Transfer transaction hash is invalid.");
  const logIndex = Number(BigInt(log.logIndex)), blockNumber = Number(BigInt(log.blockNumber));
  const sender = ("0x" + log.topics[1].slice(-40)).toLowerCase();
  const recipient = ("0x" + log.topics[2].slice(-40)).toLowerCase();
  return { eventKey: CHAIN_ID + ":" + txHash + ":" + logIndex, chainId: CHAIN_ID, token: metadata.token, symbol: metadata.symbol, decimals: metadata.decimals, amountRaw: BigInt(log.data).toString(), sender, recipient, blockNumber, txHash, logIndex };
}
export function matches(event, config) {
  return BigInt(event.amountRaw) >= BigInt(config.thresholdRaw)
    && (!config.sender || event.sender === config.sender)
    && (!config.recipient || event.recipient === config.recipient);
}
export function escapeText(value) { return String(value).replace(/[@`*_~|>\\]/g, "\\$&").slice(0, 128); }
export function makeAlert(event, config, explorerBase) {
  return [
    "PHAROS ERC-20 LARGE TRANSFER ALERT",
    "Network: Pharos Pacific Mainnet (chain ID " + event.chainId + ")",
    "Token: " + escapeText(event.symbol) + " (" + event.token + ")",
    "Amount: " + formatUnits(event.amountRaw, event.decimals) + " " + escapeText(event.symbol) + " (raw: " + event.amountRaw + ")",
    "Sender: " + event.sender,
    "Recipient: " + event.recipient,
    "Block: " + event.blockNumber,
    "Transaction: " + event.txHash,
    "Explorer: " + explorerBase + event.txHash,
    "Configured threshold: " + config.thresholdDisplay + " " + escapeText(event.symbol) + " (raw: " + config.thresholdRaw + ")",
    "Stable event ID: " + event.eventKey,
    "Detection mode: " + config.detectionMode
  ].join("\n");
}
export function classifyDeliveryError(error) {
  return error?.name === "AbortError" || /timeout|network|fetch/i.test(error?.message || "") ? "UNKNOWN_DELIVERY" : "RETRYABLE_FAILURE";
}
export function nextRange(cursor, confirmedHead, max = 1000) {
  return cursor == null || cursor > confirmedHead ? null : { from: cursor, to: Math.min(confirmedHead, cursor + max - 1) };
}
