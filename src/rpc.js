import { CHAIN_ID, TRANSFER_TOPIC, normalizeAddress } from "./core.js";

export class RpcReader {
  constructor(url, fetcher = fetch) { this.url = url; this.fetcher = fetcher; this.id = 0; }
  async call(method, params) {
    const response = await this.fetcher(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }) });
    let json; try { json = await response.json(); } catch { throw new Error("RPC " + method + " returned non-JSON HTTP " + response.status + "."); }
    if (!response.ok || json.error) throw new Error("RPC " + method + " failed: " + (json.error?.message || response.status));
    return json.result;
  }
  async verifyChain() {
    const chainId = Number(BigInt(await this.call("eth_chainId", [])));
    if (chainId !== CHAIN_ID) throw new Error("RPC chain mismatch: expected " + CHAIN_ID + ", received " + chainId + ".");
    return chainId;
  }
  async latestBlock() { return Number(BigInt(await this.call("eth_blockNumber", []))); }
  async code(address) { return this.call("eth_getCode", [normalizeAddress(address), "latest"]); }
  async contractCall(to, data) { return this.call("eth_call", [{ to: normalizeAddress(to), data }, "latest"]); }
  async logs(token, from, to) {
    if (to < from || to - from + 1 > 1000) throw new Error("Log range must contain 1 to 1,000 blocks.");
    return this.call("eth_getLogs", [{ address: normalizeAddress(token), fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [TRANSFER_TOPIC] }]);
  }
}
function bytes(hex) { return new TextDecoder().decode(Uint8Array.from(hex.match(/../g) || [], b => parseInt(b, 16))); }
function decodeString(result) {
  if (!/^0x[0-9a-fA-F]+$/.test(result || "")) throw new Error("Malformed symbol result.");
  const hex = result.slice(2);
  if (hex.length === 64) return bytes(hex).replace(/\0+$/, "");
  if (hex.length < 128) throw new Error("Malformed ABI symbol result.");
  const length = Number(BigInt("0x" + hex.slice(64, 128)));
  return bytes(hex.slice(128, 128 + length * 2));
}
export async function readMetadata(reader, token) {
  token = normalizeAddress(token, "token");
  const code = await reader.code(token);
  if (!code || code === "0x") throw new Error("Token address has no deployed bytecode.");
  const raw = await reader.contractCall(token, "0x313ce567");
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw || "")) throw new Error("Token decimals response is malformed.");
  const decimals = Number(BigInt(raw));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Token decimals are outside the ERC-20 range.");
  let symbol = "UNKNOWN"; try { symbol = decodeString(await reader.contractCall(token, "0x95d89b41")).slice(0, 32) || "UNKNOWN"; } catch {}
  return { token, decimals, symbol, codeVerified: true };
}
