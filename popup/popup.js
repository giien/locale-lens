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

init();

async function init() {
  providerPresets = await loadProviderPresets();
  renderProviderOptions(providerPresets);

  const settings = await chrome.storage.sync.get({
    provider: "minimax",
    apiStyle: "openai",
    endpoint: providerPresets.minimax.endpoint,
    model: providerPresets.minimax.model,
    apiKey: "",
    temperature: 0.2,
    markets: ["US", "CN", "DE", "FR", "ES", "JP"],
  });

  providerInput.value = settings.provider || "minimax";
  apiStyleInput.value = settings.apiStyle || getPreset(providerInput.value).apiStyle || "openai";
  endpointInput.value = settings.endpoint || getPreset(providerInput.value).endpoint || "";
  modelInput.value = settings.model || getPreset(providerInput.value).model || "";
  apiKeyInput.value = settings.apiKey || "";

  if (settings.apiKey) {
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
      label: "MiniMax",
      apiStyle: "openai",
      endpoint: "https://api.minimax.io/v1/chat/completions",
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
  const preset = getPreset(providerInput.value);
  if (!preset) return;
  apiStyleInput.value = preset.apiStyle || "openai";
  endpointInput.value = preset.endpoint || "";
  modelInput.value = preset.model || "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    provider: providerInput.value,
    apiStyle: apiStyleInput.value,
    endpoint: endpointInput.value.trim(),
    model: modelInput.value.trim(),
    apiKey: normalizeApiKey(apiKeyInput.value),
    temperature: 0.2,
    markets: ["US", "CN", "DE", "FR", "ES", "JP"],
  };

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    payload,
  });

  if (response?.ok) {
    apiKeyInput.value = payload.apiKey;
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
