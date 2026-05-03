const LocaleLensProviderPresets = Object.freeze({
  minimax: {
    label: "MiniMax",
    apiStyle: "anthropic-bearer",
    endpoint: "https://api.minimaxi.com/anthropic/v1/messages",
    model: "MiniMax-M2.7",
  },
  minimaxOpenAI: {
    label: "MiniMax OpenAI-compatible",
    hidden: true,
    apiStyle: "openai",
    endpoint: "https://api.minimaxi.com/v1/chat/completions",
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
});

function getLocaleLensVisibleProviderPresets() {
  return Object.fromEntries(
    Object.entries(LocaleLensProviderPresets).filter(([, preset]) => !preset.hidden),
  );
}

globalThis.LocaleLensProviderPresets = LocaleLensProviderPresets;
globalThis.getLocaleLensVisibleProviderPresets = getLocaleLensVisibleProviderPresets;
