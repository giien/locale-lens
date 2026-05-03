const statusNode = document.querySelector("#status");
const form = document.querySelector("#api-form");
const providerInput = document.querySelector("#provider");
const endpointInput = document.querySelector("#endpoint");
const modelInput = document.querySelector("#model");
const apiKeyInput = document.querySelector("#apiKey");
const openOptionsButton = document.querySelector("#open-options");
const openAmazonButton = document.querySelector("#open-amazon");

const PRESETS = {
  minimax: {
    endpoint: "https://api.minimax.io/v1/chat/completions",
    model: "MiniMax-M2.7",
  },
  custom: {
    endpoint: "",
    model: "",
  },
};

init();

async function init() {
  const settings = await chrome.storage.sync.get({
    provider: "minimax",
    endpoint: PRESETS.minimax.endpoint,
    model: PRESETS.minimax.model,
    apiKey: "",
    temperature: 0.2,
    markets: ["US", "CN", "DE", "FR", "ES", "JP"],
  });

  providerInput.value = settings.provider || "minimax";
  endpointInput.value = settings.endpoint || PRESETS.minimax.endpoint;
  modelInput.value = settings.model || PRESETS.minimax.model;
  apiKeyInput.value = settings.apiKey || "";

  if (settings.apiKey) {
    statusNode.textContent = "API 已配置。去 Amazon 页面刷新后使用。";
    statusNode.className = "ready";
  } else {
    statusNode.textContent = "还没有配置 API Key。";
    statusNode.className = "missing";
  }
}

providerInput.addEventListener("change", () => {
  const preset = PRESETS[providerInput.value];
  if (!preset) return;
  if (preset.endpoint) endpointInput.value = preset.endpoint;
  if (preset.model) modelInput.value = preset.model;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    provider: providerInput.value,
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

function normalizeApiKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openAmazonButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.amazon.com/s?k=portable+blender" });
});
