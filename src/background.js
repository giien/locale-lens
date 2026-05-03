importScripts("provider-presets.js");

const DEFAULT_SETTINGS = {
  provider: "minimax",
  providerConfigs: {},
  apiStyle: "anthropic-bearer",
  endpoint: "https://api.minimaxi.com/anthropic/v1/messages",
  model: "MiniMax-M2.7",
  apiKey: "",
  temperature: 1,
  markets: ["US", "CN", "DE", "FR", "ES", "JP"],
};

const PROVIDER_PRESETS = globalThis.LocaleLensProviderPresets;

const MARKET_LABELS = {
  US: "United States / English",
  CN: "China / Chinese",
  DE: "Germany / German",
  FR: "France / French",
  ES: "Spain & LatAm / Spanish",
  JP: "Japan / Japanese",
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ANALYZE_TITLE") {
    analyzeTitle(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, data: redactSettings(settings) }));
    return true;
  }

  if (message?.type === "GET_PROVIDER_PRESETS") {
    sendResponse({ ok: true, data: globalThis.getLocaleLensVisibleProviderPresets() });
    return false;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.payload)
      .then((settings) => sendResponse({ ok: true, data: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "TEST_SETTINGS") {
    testSettings(message.payload)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function analyzeTitle(payload) {
  const title = String(payload?.title || "").trim();
  if (!title) throw new Error("Missing product title.");

  const settings = await getSettings();
  settings.apiKey = normalizeApiKey(settings.apiKey);

  if (!settings.apiKey) {
    throw new Error("MiniMax API Key is not configured. Open extension options first.");
  }
  validateHeaderSafeApiKey(settings.apiKey);

  const cacheKey = `analysis:${settings.provider}:${settings.model}:${hashText(title)}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return { ...cached[cacheKey], cached: true };

  const analysis = await callConfiguredProvider(settings, {
    title,
    pageUrl: payload?.pageUrl || "",
    searchKeyword: payload?.searchKeyword || "",
    marketplace: payload?.marketplace || "US",
  });

  await chrome.storage.local.set({ [cacheKey]: analysis });
  return analysis;
}

async function testSettings(payload) {
  const provider = String(payload?.provider || DEFAULT_SETTINGS.provider).trim();
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
  const settings = normalizeProviderConfig(provider, {
    provider,
    apiStyle: String(payload?.apiStyle || preset.apiStyle || DEFAULT_SETTINGS.apiStyle).trim(),
    endpoint: String(payload?.endpoint || preset.endpoint || DEFAULT_SETTINGS.endpoint).trim(),
    model: String(payload?.model || preset.model || DEFAULT_SETTINGS.model).trim(),
    apiKey: normalizeApiKey(payload?.apiKey || ""),
    temperature: clamp(Number(payload?.temperature ?? DEFAULT_SETTINGS.temperature), 0, 1),
  });

  settings.provider = provider;
  settings.markets = DEFAULT_SETTINGS.markets;

  if (!settings.apiKey) {
    throw new Error("请先填写 API Key。");
  }
  validateHeaderSafeApiKey(settings.apiKey);

  const content = await callProviderSmokeTest(settings);
  return {
    provider,
    endpoint: settings.endpoint,
    model: settings.model,
    sample: content.slice(0, 80),
  };
}

async function callConfiguredProvider(settings, context) {
  const apiStyle = settings.apiStyle || "openai";
  if (apiStyle === "anthropic" || apiStyle === "anthropic-bearer") {
    return callAnthropicMessages(settings, context);
  }

  return callOpenAICompatible(settings, context);
}

async function callProviderSmokeTest(settings) {
  const apiStyle = settings.apiStyle || "openai";
  const prompt = 'Reply with exactly this JSON: {"ok":true}';
  if (apiStyle === "anthropic" || apiStyle === "anthropic-bearer") {
    return callAnthropicSmokeTest(settings, prompt);
  }

  return callOpenAISmokeTest(settings, prompt);
}

async function callOpenAISmokeTest(settings, prompt) {
  const apiKey = normalizeApiKey(settings.apiKey);
  validateHeaderSafeApiKey(apiKey);

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: buildOpenAICompatibleHeaders(settings.provider, apiKey),
    body: JSON.stringify({
      model: settings.model,
      temperature: Number(settings.temperature ?? 1),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throwProviderRequestError(settings, response.status, body);
  }

  const payload = JSON.parse(body);
  const content = extractOpenAICompatibleContent(payload);
  if (!content) throw new Error("测试成功收到响应，但没有文本内容。");
  return content;
}

async function callAnthropicSmokeTest(settings, prompt) {
  const apiKey = normalizeApiKey(settings.apiKey);
  validateHeaderSafeApiKey(apiKey);

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: buildAnthropicHeaders(settings.apiStyle, apiKey),
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 64,
      temperature: Number(settings.temperature ?? 1),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throwProviderRequestError(settings, response.status, body);
  }

  const payload = JSON.parse(body);
  const content = Array.isArray(payload.content)
    ? payload.content.filter((item) => item?.type === "text").map((item) => item.text).join("\n")
    : "";
  if (!content) throw new Error("测试成功收到响应，但没有文本内容。");
  return content;
}

function buildKeywordPrompt(context, markets) {
  return [
    "You are an Amazon and TikTok cross-border ecommerce keyword research expert.",
    "Analyze the Amazon product title and return localized search terms for product research.",
    "",
    "Rules:",
    "1. Do not translate word by word. Use expressions local shoppers would search.",
    "2. Extract product type, head terms, long-tail terms, attribute terms, and use-case terms.",
    "3. Keep output concise. Prefer high-intent ecommerce keywords.",
    "4. For Spanish, consider both Spain and broad Spanish-speaking ecommerce usage.",
    "5. For Japanese, prefer natural Japanese ecommerce search phrases.",
    "6. Return valid JSON only. No markdown.",
    "7. Keep JSON compact: max 5 coreTerms, max 3 headTerms and 4 longTailTerms per market, localExpressionNotes under 40 Chinese characters.",
    "8. Do not include comments, trailing commas, code fences, or explanatory prose.",
    "",
    "Markets:",
    markets,
    "",
    "JSON schema:",
    JSON.stringify({
      sourceTitle: "string",
      productType: "string",
      coreTerms: [
        {
          term: "portable blender",
          role: "head | long_tail | attribute | use_case",
          reason: "short Chinese reason",
        },
      ],
      markets: [
        {
          market: "US",
          language: "English",
          headTerms: ["term"],
          longTailTerms: ["term"],
          localExpressionNotes: "short Chinese note",
        },
      ],
    }),
    "",
    `Amazon marketplace: ${context.marketplace}`,
    `Current search keyword: ${context.searchKeyword || "(none)"}`,
    `Product title: ${context.title}`,
  ].join("\n");
}

async function callOpenAICompatible(settings, context) {
  const apiKey = normalizeApiKey(settings.apiKey);
  validateHeaderSafeApiKey(apiKey);
  const markets = settings.markets.map((market) => `${market}: ${MARKET_LABELS[market] || market}`).join("\n");
  const prompt = buildKeywordPrompt(context, markets);

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: buildOpenAICompatibleHeaders(settings.provider, apiKey),
    body: JSON.stringify(buildOpenAICompatibleBody(settings, prompt)),
  });

  const body = await response.text();
  if (!response.ok) {
    throwProviderRequestError(settings, response.status, body);
  }

  const payload = JSON.parse(body);
  const content = extractOpenAICompatibleContent(payload);
  if (!content) throw new Error("AI response did not contain message content.");

  const parsed = parseJsonContent(content);
  return normalizeAnalysis(parsed, context.title);
}

async function callAnthropicMessages(settings, context) {
  const apiKey = normalizeApiKey(settings.apiKey);
  validateHeaderSafeApiKey(apiKey);
  const markets = settings.markets.map((market) => `${market}: ${MARKET_LABELS[market] || market}`).join("\n");
  const prompt = buildKeywordPrompt(context, markets);

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: buildAnthropicHeaders(settings.apiStyle, apiKey),
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 3200,
      temperature: Number(settings.temperature ?? 1),
      system: "You produce compact, valid JSON for ecommerce keyword localization.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throwProviderRequestError(settings, response.status, body);
  }

  const payload = JSON.parse(body);
  const content = Array.isArray(payload.content)
    ? payload.content.filter((item) => item?.type === "text").map((item) => item.text).join("\n")
    : "";
  if (!content) throw new Error("AI response did not contain message content.");

  const parsed = parseJsonContent(content);
  return normalizeAnalysis(parsed, context.title);
}

function buildOpenAICompatibleBody(settings, prompt) {
  return {
    model: settings.model,
    temperature: Number(settings.temperature ?? 1),
    messages: [
      {
        role: "system",
        content: "You produce compact, valid JSON for ecommerce keyword localization.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  };
}

function buildOpenAICompatibleHeaders(provider, apiKey) {
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/giien/locale-lens";
    headers["X-Title"] = "LocaleLens";
  }

  return headers;
}

function buildAnthropicHeaders(apiStyle, apiKey) {
  if (apiStyle === "anthropic-bearer") {
    return {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

function extractOpenAICompatibleContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || "").join("\n");
  }
  return content;
}

function parseJsonContent(content) {
  const withoutThinking = String(content).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const withoutFence = withoutThinking
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch (firstError) {
    const jsonText = extractLikelyJsonObject(withoutFence);
    if (jsonText) {
      const repaired = repairJsonText(jsonText);
      try {
        return JSON.parse(repaired);
      } catch (repairError) {
        throw new Error(
          `AI response was not valid JSON after repair: ${repairError.message}. Original error: ${firstError.message}`,
        );
      }
    }
    throw new Error(`AI response was not valid JSON: ${firstError.message}`);
  }
}

function extractLikelyJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";

  let inString = false;
  let escape = false;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }

  return text.slice(start);
}

function repairJsonText(text) {
  let repaired = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/"\s+"/g, '","')
    .replace(/}\s*{/g, "},{")
    .replace(/]\s*\[/g, "],[")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();

  const balance = getJsonBalance(repaired);
  if (balance.inString) repaired += '"';
  if (balance.square > 0) repaired += "]".repeat(balance.square);
  if (balance.curly > 0) repaired += "}".repeat(balance.curly);
  return repaired;
}

function getJsonBalance(text) {
  let curly = 0;
  let square = 0;
  let inString = false;
  let escape = false;

  for (const char of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") curly += 1;
    if (char === "}") curly = Math.max(0, curly - 1);
    if (char === "[") square += 1;
    if (char === "]") square = Math.max(0, square - 1);
  }

  return { curly, square, inString };
}

function normalizeAnalysis(analysis, fallbackTitle) {
  const coreTerms = Array.isArray(analysis.coreTerms) ? analysis.coreTerms.slice(0, 8) : [];
  const markets = Array.isArray(analysis.markets) ? analysis.markets.slice(0, 8) : [];

  return {
    sourceTitle: String(analysis.sourceTitle || fallbackTitle),
    productType: String(analysis.productType || ""),
    coreTerms: coreTerms.map((item) => ({
      term: String(item.term || "").trim(),
      role: normalizeRole(item.role),
      reason: String(item.reason || "").trim(),
    })).filter((item) => item.term),
    markets: markets.map((item) => ({
      market: String(item.market || "").trim(),
      language: String(item.language || "").trim(),
      headTerms: toStringList(item.headTerms).slice(0, 4),
      longTailTerms: toStringList(item.longTailTerms).slice(0, 6),
      localExpressionNotes: String(item.localExpressionNotes || "").trim(),
    })).filter((item) => item.market && (item.headTerms.length || item.longTailTerms.length)),
    generatedAt: new Date().toISOString(),
  };
}

function normalizeRole(role) {
  const allowed = new Set(["head", "long_tail", "attribute", "use_case"]);
  return allowed.has(role) ? role : "head";
}

function toStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const preset = PROVIDER_PRESETS[stored.provider] || PROVIDER_PRESETS.minimax;
  const providerConfig = normalizeProviderConfig(
    stored.provider,
    getProviderConfig(stored.provider, stored.providerConfigs, stored),
  );

  return {
    ...DEFAULT_SETTINGS,
    ...preset,
    ...stored,
    ...providerConfig,
    apiStyle: providerConfig.apiStyle || preset.apiStyle || DEFAULT_SETTINGS.apiStyle,
    endpoint: providerConfig.endpoint || preset.endpoint || DEFAULT_SETTINGS.endpoint,
    model: providerConfig.model || preset.model || DEFAULT_SETTINGS.model,
    apiKey: providerConfig.apiKey || "",
    temperature: providerConfig.temperature ?? stored.temperature ?? DEFAULT_SETTINGS.temperature,
    markets: Array.isArray(stored.markets) && stored.markets.length ? stored.markets : DEFAULT_SETTINGS.markets,
  };
}

async function saveSettings(payload) {
  const provider = String(payload?.provider || DEFAULT_SETTINGS.provider).trim();
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const providerConfigs = {
    ...(isPlainObject(stored.providerConfigs) ? stored.providerConfigs : {}),
  };
  const previousConfig = isPlainObject(providerConfigs[provider]) ? providerConfigs[provider] : {};
  let apiKey = normalizeApiKey(payload?.apiKey || "");
  if (apiKey === "********" && previousConfig.apiKey) {
    apiKey = previousConfig.apiKey;
  }
  if (apiKey) validateHeaderSafeApiKey(apiKey);

  const providerConfig = {
    apiStyle: String(payload?.apiStyle || preset.apiStyle || "openai").trim(),
    endpoint: String(payload?.endpoint || preset.endpoint || DEFAULT_SETTINGS.endpoint).trim(),
    model: String(payload?.model || preset.model || DEFAULT_SETTINGS.model).trim(),
    apiKey,
    temperature: clamp(Number(payload?.temperature ?? DEFAULT_SETTINGS.temperature), 0, 1),
  };

  providerConfigs[provider] = normalizeProviderConfig(provider, providerConfig);

  const settings = {
    provider,
    providerConfigs,
    ...providerConfigs[provider],
    markets: Array.isArray(payload?.markets) && payload.markets.length ? payload.markets : DEFAULT_SETTINGS.markets,
  };

  await chrome.storage.sync.set(settings);
  return settings;
}

function redactSettings(settings) {
  const providerConfigs = Object.fromEntries(
    Object.entries(settings.providerConfigs || {}).map(([provider, config]) => [
      provider,
      {
        ...config,
        apiKey: config?.apiKey ? "********" : "",
        hasApiKey: Boolean(config?.apiKey),
      },
    ]),
  );

  return {
    ...settings,
    apiKey: settings.apiKey ? "********" : "",
    hasApiKey: Boolean(settings.apiKey),
    providerConfigs,
  };
}

function normalizeError(error) {
  const message = error?.message || String(error || "Unknown error");
  return humanizeErrorMessage(message);
}

function throwProviderRequestError(settings, status, body) {
  const providerName = PROVIDER_PRESETS[settings.provider]?.label || settings.provider;
  const providerBody = extractProviderErrorBody(body);
  const hint = `当前配置：${providerName} / ${settings.model} / ${settings.apiStyle}`;
  let message = "";

  if (status === 401 || status === 403) {
    message = `API Key 验证失败。请检查 ${providerName} 的 API Key 是否复制完整、是否有权限，不要带 Bearer 前缀。`;
  } else if (status === 429) {
    message = "请求太频繁或额度不足。请稍后重试，或检查服务商账户余额和限额。";
  } else if (status === 404) {
    message = "接口地址或模型名称可能不对。请检查 Endpoint 和 Model。";
  } else if (status >= 400 && status < 500) {
    message = "服务商没有接受当前请求。请检查 Provider、API Style、Endpoint 和 Model 是否匹配。";
  } else if (status >= 500) {
    message = "服务商接口暂时不可用。请稍后重试，或临时切换到其他 Provider。";
  } else {
    message = `AI 请求失败 (${status})。`;
  }

  throw new Error(`${message}\n${hint}${providerBody ? `\n服务商返回：${providerBody}` : ""}`);
}

function humanizeErrorMessage(message) {
  const text = String(message || "").trim();
  if (!text) return "模型没有返回可用内容，请稍后重试。";
  if (/401|403|invalid api key|authorized_error|unauthorized/i.test(text)) {
    return "API Key 验证失败。请检查当前 Provider 的 API Key 是否完整、是否有权限，不要带 Bearer 前缀。";
  }
  if (/429|rate limit|quota|insufficient|balance|billing/i.test(text)) {
    return "请求太频繁或额度不足。请稍后重试，或检查服务商账户余额和限额。";
  }
  if (/404|not found/i.test(text)) {
    return "接口地址或模型名称可能不对。请打开配置页检查 Endpoint 和 Model。";
  }
  if (/400|bad request|invalid request/i.test(text)) {
    return "服务商没有接受当前请求。请检查 Provider、API Style、Endpoint 和 Model 是否匹配。";
  }
  if (/not valid JSON|Expected ','|Unexpected token|Unexpected end/i.test(text)) {
    return "模型回复的 JSON 格式不完整。可以点“重试”，或换一个更稳定的模型再试。";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return "网络请求没有发出去。请检查网络、服务商 Endpoint，或稍后重试。";
  }
  if (/Missing product title/i.test(text)) {
    return "没有读到商品标题。请刷新 Amazon 页面后再试。";
  }
  if (/API Key is not configured|请先填写 API Key/i.test(text)) {
    return "还没有配置 API Key。请点击插件图标保存配置后再分析。";
  }
  return text.split("\n")[0].slice(0, 220);
}

function extractProviderErrorBody(body) {
  const text = String(body || "").trim();
  if (!text) return "";

  try {
    const json = JSON.parse(text);
    return String(
      json?.error?.message
      || json?.message
      || json?.error
      || "",
    ).slice(0, 180);
  } catch (_error) {
    return text.replace(/\s+/g, " ").slice(0, 180);
  }
}

function normalizeApiKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeProviderConfig(provider, config = {}) {
  const normalized = { ...config };

  if (provider === "minimax") {
    if (
      !normalized.endpoint
      || normalized.endpoint.includes("api.minimax.io")
      || normalized.endpoint === "https://api.minimaxi.com/v1/chat/completions"
    ) {
      normalized.endpoint = PROVIDER_PRESETS.minimax.endpoint;
    }
    normalized.apiStyle = "anthropic-bearer";
  }

  if (provider === "minimaxOpenAI") {
    if (!normalized.endpoint || normalized.endpoint.includes("api.minimax.io")) {
      normalized.endpoint = PROVIDER_PRESETS.minimaxOpenAI.endpoint;
    }
    normalized.apiStyle = "openai";
  }

  return normalized;
}

function getProviderConfig(provider, providerConfigs, stored) {
  if (isPlainObject(providerConfigs) && isPlainObject(providerConfigs[provider])) {
    return providerConfigs[provider];
  }

  if (provider === stored.provider) {
    return {
      apiStyle: stored.apiStyle,
      endpoint: stored.endpoint,
      model: stored.model,
      apiKey: stored.apiKey,
      temperature: stored.temperature,
    };
  }

  return {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateHeaderSafeApiKey(apiKey) {
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    throw new Error("API Key 里包含中文、全角符号、换行或不可见字符。请重新复制纯 API Key，不要带 Bearer。");
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return DEFAULT_SETTINGS.temperature;
  const clamped = Math.min(max, Math.max(min, value));
  return clamped === 0 ? DEFAULT_SETTINGS.temperature : clamped;
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
