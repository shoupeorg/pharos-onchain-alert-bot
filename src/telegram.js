export function validateTelegramSecrets(token, chatId) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token || "")) throw new Error("Telegram bot token is not configured correctly.");
  if (!/^-?\d+$/.test(chatId || "")) throw new Error("Telegram chat ID is not configured correctly.");
  return { token, chatId: String(chatId) };
}
export function telegramRequest(token, chatId, text) {
  validateTelegramSecrets(token, chatId);
  return {
    url: "https://api.telegram.org/bot" + token + "/sendMessage",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text: String(text).slice(0, 4096), link_preview_options: { is_disabled: true } })
    }
  };
}
export function classifyTelegramResponse(status, bodyText) {
  let body; try { body = JSON.parse(bodyText); } catch { body = null; }
  if (status >= 200 && status < 300 && body?.ok === true && Number.isInteger(body?.result?.message_id)) return { kind: "DELIVERED", messageId: String(body.result.message_id) };
  if (status === 429) return { kind: "RATE_LIMIT", retryAfter: Math.max(1, Math.min(300, Number(body?.parameters?.retry_after) || 5)), error: body?.description || "Telegram rate limit." };
  if (status >= 500) return { kind: "RETRYABLE_FAILURE", error: body?.description || "Telegram server failure." };
  return { kind: "REJECTED", error: body?.description || "Telegram definitively rejected delivery." };
}
