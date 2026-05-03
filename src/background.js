const DEFAULT_SETTINGS = {
  provider: "minimax",
  apiStyle: "openai",
  endpoint: "https://api.minimax.io/v1/chat/completions",
  model: "MiniMax-M2.7",
  apiKey: "",
  temperature: 0.2,
  markets: ["US", "CN", "DE", "FR", "ES", "JP"],
};

const PROVIDER_PRESETS = {
  minimax: {
    label: "MiniMax",
    apiStyle: "openai",
    endpoint: "https://api.minimax.io/v1/chat/completions",
    model: "MiniMax-M2.7",
  },
  openai: {
    label: "OpenAI",
    apiStyle: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  openrouter: {
    label: "OpenRouter",
    apiStyle: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-4o-mini",
  },
  deepseek: {
    label: "DeepSeek",
    apiStyle: "openai",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
  qwen: {
    label: "Qwen / Alibaba DashScope",
    apiStyle: "openai",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
  },
  groq: {
    label: "Groq",
    apiStyle: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  gemini: {
    label: "Google Gemini",
    apiStyle: "openai",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
  },
  anthropic: {
    label: "Anthropic / Claude",
    apiStyle: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-3-5-haiku-latest",
  },
  siliconflow: {
    label: "SiliconFlow",
    apiStyle: "openai",
    endpoint: "https://api.siliconflow.com/v1/chat/completions",
    model: "Qwen/Qwen3-8B",
  },
  custom: {
    label: "Custom",
    apiStyle: "openai",
    endpoint: "",
    model: "",
  },
};

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
    sendResponse({ ok: true, data: PROVIDER_PRESETS });
    return false;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.payload)
      .then((settings) => sendResponse({ ok: true, data: redactSettings(settings) }))
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

async function callConfiguredProvider(settings, context) {
  if ((settings.apiStyle || "openai") === "anthropic") {
    return callAnthropicMessages(settings, context);
  }

  return callOpenAICompatible(settings, context);
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
    body: JSON.stringify({
      model: settings.model,
      temperature: Number(settings.temperature ?? 0.2),
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
      response_format: { type: "json_object" },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`AI request failed (${response.status}): ${body.slice(0, 240)}`);
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
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1600,
      temperature: Number(settings.temperature ?? 0.2),
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
    throw new Error(`AI request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const payload = JSON.parse(body);
  const content = Array.isArray(payload.content)
    ? payload.content.filter((item) => item?.type === "text").map((item) => item.text).join("\n")
    : "";
  if (!content) throw new Error("AI response did not contain message content.");

  const parsed = parseJsonContent(content);
  return normalizeAnalysis(parsed, context.title);
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

function extractOpenAICompatibleContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || "").join("\n");
  }
  return content;
}

function parseJsonContent(content) {
  const withoutThinking = String(content).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const withoutFence = withoutThinking.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch (_error) {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
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
  return {
    ...DEFAULT_SETTINGS,
    ...preset,
    ...stored,
    apiStyle: stored.apiStyle || preset.apiStyle || DEFAULT_SETTINGS.apiStyle,
    endpoint: stored.endpoint || preset.endpoint || DEFAULT_SETTINGS.endpoint,
    model: stored.model || preset.model || DEFAULT_SETTINGS.model,
    markets: Array.isArray(stored.markets) && stored.markets.length ? stored.markets : DEFAULT_SETTINGS.markets,
  };
}

async function saveSettings(payload) {
  const apiKey = normalizeApiKey(payload?.apiKey || "");
  if (apiKey) validateHeaderSafeApiKey(apiKey);
  const provider = String(payload?.provider || DEFAULT_SETTINGS.provider).trim();
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;

  const settings = {
    provider,
    apiStyle: String(payload?.apiStyle || preset.apiStyle || "openai").trim(),
    endpoint: String(payload?.endpoint || preset.endpoint || DEFAULT_SETTINGS.endpoint).trim(),
    model: String(payload?.model || preset.model || DEFAULT_SETTINGS.model).trim(),
    apiKey,
    temperature: clamp(Number(payload?.temperature ?? DEFAULT_SETTINGS.temperature), 0, 1),
    markets: Array.isArray(payload?.markets) && payload.markets.length ? payload.markets : DEFAULT_SETTINGS.markets,
  };
  await chrome.storage.sync.set(settings);
  return settings;
}

function redactSettings(settings) {
  return {
    ...settings,
    apiKey: settings.apiKey ? "********" : "",
    hasApiKey: Boolean(settings.apiKey),
  };
}

function normalizeError(error) {
  return error?.message || String(error || "Unknown error");
}

function normalizeApiKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function validateHeaderSafeApiKey(apiKey) {
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    throw new Error("API Key 里包含中文、全角符号、换行或不可见字符。请重新复制纯 API Key，不要带 Bearer。");
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return DEFAULT_SETTINGS.temperature;
  return Math.min(max, Math.max(min, value));
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
