const statusNode = document.querySelector("#status");
const form = document.querySelector("#api-form");
const providerInput = document.querySelector("#provider");
const apiStyleInput = document.querySelector("#apiStyle");
const endpointInput = document.querySelector("#endpoint");
const modelInput = document.querySelector("#model");
const apiKeyInput = document.querySelector("#apiKey");
const openOptionsButton = document.querySelector("#open-options");
const openAmazonButton = document.querySelector("#open-amazon");

let providerPresets = {};
let providerConfigs = {};

init();

async function init() {
  providerPresets = await loadProviderPresets();
  renderProviderOptions(providerPresets);

  const settings = await chrome.storage.sync.get({
    provider: "minimax",
    providerConfigs: {},
    apiStyle: "openai",
    endpoint: providerPresets.minimax.endpoint,
    model: providerPresets.minimax.model,
    apiKey: "",
    temperature: 1,
    markets: ["US", "CN", "DE", "FR", "ES", "JP"],
  });
  providerConfigs = isPlainObject(settings.providerConfigs) ? settings.providerConfigs : {};

  providerInput.value = settings.provider || "minimax";
  const activeConfig = getSavedConfig(providerInput.value, settings);
  applyProviderConfig(providerInput.value, activeConfig);

  if (activeConfig.apiKey) {
    statusNode.textContent = "API 已配置。去 Amazon 页面刷新后使用。";
    statusNode.className = "ready";
  } else {
    statusNode.textContent = "还没有配置 API Key。";
    statusNode.className = "missing";
  }
}

async function loadProviderPresets() {
  const response = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_PRESETS" });
  if (response?.ok) return response.data;
  return {
    minimax: {
      label: "MiniMax OpenAI-compatible",
      apiStyle: "openai",
      endpoint: "https://api.minimaxi.com/v1/chat/completions",
      model: "MiniMax-M2.7",
    },
    custom: {
      label: "Custom",
      apiStyle: "openai",
      endpoint: "",
      model: "",
    },
  };
}

function renderProviderOptions(presets) {
  providerInput.innerHTML = Object.entries(presets)
    .map(([value, preset]) => `<option value="${escapeHtml(value)}">${escapeHtml(preset.label || value)}</option>`)
    .join("");
}

providerInput.addEventListener("change", () => {
  applyProviderConfig(providerInput.value, getSavedConfig(providerInput.value));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = providerInput.value;
  const payload = {
    provider,
    apiStyle: apiStyleInput.value,
    endpoint: endpointInput.value.trim(),
    model: modelInput.value.trim(),
    apiKey: normalizeApiKey(apiKeyInput.value),
    temperature: 1,
    markets: ["US", "CN", "DE", "FR", "ES", "JP"],
  };

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    payload,
  });

  if (response?.ok) {
    apiKeyInput.value = payload.apiKey;
    providerConfigs = response.data.providerConfigs || {
      ...providerConfigs,
      [provider]: { ...payload },
    };
    statusNode.textContent = "已保存。刷新 Amazon 页面后使用。";
    statusNode.className = "ready";
  } else {
    statusNode.textContent = response?.error || "保存失败。";
    statusNode.className = "missing";
  }
});

function getPreset(provider) {
  return providerPresets[provider] || providerPresets.custom || {};
}

function getSavedConfig(provider, fallbackSettings = {}) {
  const preset = getPreset(provider);
  const saved = isPlainObject(providerConfigs[provider]) ? providerConfigs[provider] : {};

  if (provider === fallbackSettings.provider && !Object.keys(saved).length) {
    return {
      apiStyle: fallbackSettings.apiStyle,
      endpoint: fallbackSettings.endpoint,
      model: fallbackSettings.model,
      apiKey: fallbackSettings.apiKey,
    };
  }

  return {
    apiStyle: saved.apiStyle || preset.apiStyle || "openai",
    endpoint: saved.endpoint || preset.endpoint || "",
    model: saved.model || preset.model || "",
    apiKey: saved.apiKey || "",
  };
}

function applyProviderConfig(provider, config = {}) {
  const preset = getPreset(provider);
  apiStyleInput.value = config.apiStyle || preset.apiStyle || "openai";
  endpointInput.value = config.endpoint || preset.endpoint || "";
  modelInput.value = config.model || preset.model || "";
  apiKeyInput.value = config.apiKey || "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeApiKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openAmazonButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.amazon.com/s?k=portable+blender" });
});
