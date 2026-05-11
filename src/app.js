import {
  acceptGeneration,
  acceptGenerationAsNewChapter,
  buildStorySummaryFromChapterSummariesPrompt,
  buildContext,
  buildPrompt,
  countTextChars,
  collectChapterSummaries,
  createProject,
  cryptoSafeId,
  createThinkFilter,
  serializeProjectToTxt,
  splitNovel,
  trimToLimit
} from "./novel-core.js";

const STORAGE_KEY = "novel-context-manager:v1";
const LLM_CONFIG_KEY = "novel-context-manager:llm-config:v1";
const SIDEBAR_COLLAPSED_KEY = "novel-context-manager:sidebar-collapsed";
const STORY_SUMMARY_LIMIT = 2000;
const DEFAULT_MAX_TOKENS = 128000;
const DEFAULT_SYSTEM_PROMPT = "你是一名长篇小说续写助手。严格保持人物、设定、视角、文风和节奏一致；只输出可直接追加到正文的小说正文，不要解释上下文，不要列提纲。";

const state = {
  project: createProject("未命名小说", []),
  llmConfig: loadLlmConfig(),
  selectedChapterId: null,
  excludedIds: new Set(),
  pinnedIds: new Set(),
  lastContext: null,
  lastPrompt: "",
  generationController: null,
  isGenerating: false,
  isReaderFocusMode: false,
  readerScrollFrame: null,
  thinkFilter: createThinkFilter()
};

const els = {
  appShell: document.querySelector("#appShell"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  fileInput: document.querySelector("#fileInput"),
  exportTxtButton: document.querySelector("#exportTxtButton"),
  bindTxtButton: document.querySelector("#bindTxtButton"),
  fileWriteStatus: document.querySelector("#fileWriteStatus"),
  chapterCount: document.querySelector("#chapterCount"),
  totalChars: document.querySelector("#totalChars"),
  projectTitle: document.querySelector("#projectTitle"),
  clearProjectButton: document.querySelector("#clearProjectButton"),
  storySummary: document.querySelector("#storySummary"),
  generateBookSummaryButton: document.querySelector("#generateBookSummaryButton"),
  updateSummaryButton: document.querySelector("#updateSummaryButton"),
  stopSummaryButton: document.querySelector("#stopSummaryButton"),
  organizeStatus: document.querySelector("#organizeStatus"),
  summaryCount: document.querySelector("#summaryCount"),
  splitStatus: document.querySelector("#splitStatus"),
  chapterList: document.querySelector("#chapterList"),
  readerStatus: document.querySelector("#readerStatus"),
  readerFocusButton: document.querySelector("#readerFocusButton"),
  readerChapterSelect: document.querySelector("#readerChapterSelect"),
  readerChapterList: document.querySelector("#readerChapterList"),
  readerContent: document.querySelector("#readerContent"),
  chapterTitle: document.querySelector("#chapterTitle"),
  chapterSummary: document.querySelector("#chapterSummary"),
  chapterBody: document.querySelector("#chapterBody"),
  draftSummaryButton: document.querySelector("#draftSummaryButton"),
  stopChapterSummaryButton: document.querySelector("#stopChapterSummaryButton"),
  addKnowledgeButton: document.querySelector("#addKnowledgeButton"),
  knowledgeList: document.querySelector("#knowledgeList"),
  currentChapterSelect: document.querySelector("#currentChapterSelect"),
  writeModeInputs: [...document.querySelectorAll("input[name='writeMode']")],
  newChapterTitleWrap: document.querySelector("#newChapterTitleWrap"),
  newChapterTitle: document.querySelector("#newChapterTitle"),
  userRequest: document.querySelector("#userRequest"),
  writingRules: document.querySelector("#writingRules"),
  candidateText: document.querySelector("#candidateText"),
  generateButton: document.querySelector("#generateButton"),
  stopGenerationButton: document.querySelector("#stopGenerationButton"),
  acceptGenerationButton: document.querySelector("#acceptGenerationButton"),
  generationStatus: document.querySelector("#generationStatus"),
  buildContextButton: document.querySelector("#buildContextButton"),
  contextPreview: document.querySelector("#contextPreview"),
  promptPreview: document.querySelector("#promptPreview"),
  saveLlmConfigButton: document.querySelector("#saveLlmConfigButton"),
  llmBaseUrl: document.querySelector("#llmBaseUrl"),
  llmModel: document.querySelector("#llmModel"),
  llmApiKey: document.querySelector("#llmApiKey"),
  llmTemperature: document.querySelector("#llmTemperature"),
  llmMaxTokens: document.querySelector("#llmMaxTokens"),
  llmSystemPrompt: document.querySelector("#llmSystemPrompt"),
  textEditorDialog: document.querySelector("#textEditorDialog"),
  textEditorTitle: document.querySelector("#textEditorTitle"),
  expandedTextEditor: document.querySelector("#expandedTextEditor"),
  applyTextEditorButton: document.querySelector("#applyTextEditorButton"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount")
};

load();
bindEvents();
render();
renderSidebarState();

function bindEvents() {
  document.querySelectorAll(".nav-tabs button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  els.sidebarToggle.addEventListener("click", toggleSidebar);
  els.fileInput.addEventListener("change", handleFileImport);
  els.exportTxtButton.addEventListener("click", exportTxt);
  els.bindTxtButton.addEventListener("click", bindWritableTxtFile);
  els.projectTitle.addEventListener("input", () => {
    state.project.title = els.projectTitle.value.trim() || "未命名小说";
    state.project.updatedAt = new Date().toISOString();
    persistProject();
  });
  els.storySummary.addEventListener("input", () => {
    state.project.storySummary = trimToLimit(els.storySummary.value, STORY_SUMMARY_LIMIT);
    els.storySummary.value = state.project.storySummary;
    if (state.project.storySummary.trim() && els.organizeStatus.textContent.startsWith("当前全书摘要为空")) {
      setStatus("organize", "");
    }
    renderStats();
    persistProject();
  });
  els.generateBookSummaryButton.addEventListener("click", generateStorySummaryFromChapterSummaries);
  els.updateSummaryButton.addEventListener("click", updateStorySummary);
  els.stopSummaryButton.addEventListener("click", stopGeneration);
  els.chapterTitle.addEventListener("input", updateSelectedChapter);
  els.chapterSummary.addEventListener("input", () => {
    updateSelectedChapter();
    persistProject();
  });
  els.chapterBody.addEventListener("input", updateSelectedChapter);
  els.draftSummaryButton.addEventListener("click", generateSelectedSummary);
  els.stopChapterSummaryButton.addEventListener("click", stopGeneration);
  els.addKnowledgeButton?.addEventListener("click", addKnowledgeItem);
  els.readerChapterSelect.addEventListener("change", () => jumpToReaderChapter(els.readerChapterSelect.value));
  els.readerFocusButton.addEventListener("click", toggleReaderFocusMode);
  els.readerContent.addEventListener("scroll", handleReaderScroll);
  els.currentChapterSelect.addEventListener("change", () => {
    state.project.currentChapterId = els.currentChapterSelect.value;
    state.selectedChapterId = els.currentChapterSelect.value;
    buildAndRenderContext();
    render();
  });
  els.writeModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      renderWriteMode();
      buildAndRenderContext();
    });
  });
  els.newChapterTitle.addEventListener("input", refreshContextPreview);
  els.userRequest.addEventListener("input", refreshContextPreview);
  els.writingRules.addEventListener("input", refreshContextPreview);
  els.buildContextButton.addEventListener("click", buildAndRenderContext);
  els.generateButton.addEventListener("click", generateContinuation);
  els.stopGenerationButton.addEventListener("click", stopGeneration);
  els.acceptGenerationButton.addEventListener("click", acceptCandidate);
  els.saveLlmConfigButton.addEventListener("click", saveLlmConfigFromForm);
  els.clearProjectButton.addEventListener("click", clearAll);
  els.applyTextEditorButton.addEventListener("click", applyExpandedText);
  els.textEditorDialog.addEventListener("close", () => {
    state.expandedTextarea = null;
  });
}

function toggleSidebar() {
  const collapsed = !els.appShell.classList.contains("sidebar-collapsed");
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  renderSidebarState();
}

function renderSidebarState() {
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  els.appShell.classList.toggle("sidebar-collapsed", collapsed);
  els.sidebarToggle.textContent = collapsed ? "›" : "‹";
  els.sidebarToggle.title = collapsed ? "展开侧边栏" : "折叠侧边栏";
  els.sidebarToggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "折叠侧边栏");
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === tabId));
  if (tabId === "context") {
    setCurrentChapterToLatest();
    renderChapterSelect();
    buildAndRenderContext();
  }
  if (tabId === "reader") {
    renderReader();
  } else if (state.isReaderFocusMode) {
    state.isReaderFocusMode = false;
    renderReaderFocusMode();
  }
}

async function handleFileImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const chapters = splitNovel(text);
  state.project = createProject(file.name.replace(/\.(txt|md)$/i, ""), chapters);
  state.selectedChapterId = chapters.at(-1)?.id || null;
  state.excludedIds.clear();
  state.pinnedIds.clear();
  state.lastContext = null;
  state.lastPrompt = "";
  render();
  switchTab("organize");
}

function updateSelectedChapter() {
  const chapter = getSelectedChapter();
  if (!chapter) return;
  chapter.title = els.chapterTitle.value.trim() || `第 ${chapter.order} 章`;
  chapter.summary = els.chapterSummary.value.trim();
  chapter.summaryStatus = chapter.summary ? "manual" : "missing";
  chapter.body = els.chapterBody.value;
  chapter.charCount = countTextChars(chapter.body);
  state.project.updatedAt = new Date().toISOString();
  renderStats();
  renderChapterList();
  renderChapterSelect();
  renderReader();
  persistProject();
}

async function generateSelectedSummary() {
  if (state.isGenerating) return;
  const chapter = getSelectedChapter();
  if (!chapter) return;
  const config = prepareLlmConfigOrSwitch();
  if (!config) return;

  const prompt = [
    "请为以下小说章节生成摘要。",
    "要求：150-300个中文字符；重点包含本章事件、人物状态变化、重要线索、伏笔、地点变化；只输出摘要正文，不要标题、解释或项目符号。",
    `章节标题：${chapter.title}`,
    "章节正文：",
    chapter.body
  ].join("\n\n");

  const previousSummary = chapter.summary || "";
  let chapterSummaryStarted = false;
  await runStreamingAiTask({
    statusTarget: "organize",
    workingMessage: "正在调用 LLM 生成当前章节摘要...",
    doneMessage: "章节摘要生成完成。",
    onDelta: (delta) => {
      if (!chapterSummaryStarted) {
        els.chapterSummary.value = "";
        chapterSummaryStarted = true;
      }
      els.chapterSummary.value += delta;
      els.chapterSummary.scrollTop = els.chapterSummary.scrollHeight;
      chapter.summary = els.chapterSummary.value.trim();
      chapter.summaryStatus = "ai";
      renderStats();
    },
    onDone: () => {
      chapter.summary = els.chapterSummary.value.trim();
      chapter.summaryStatus = chapter.summary ? "ai" : "missing";
      persistProject();
      renderChapterList();
    },
    onError: () => {
      chapter.summary = previousSummary;
      els.chapterSummary.value = previousSummary;
      chapter.summaryStatus = previousSummary ? "manual" : "missing";
      renderChapterList();
    },
    request: {
      config,
      prompt,
      systemPrompt: "你是一名长篇小说章节摘要助手。只输出摘要正文，不输出思考过程、标题或解释。",
      temperature: 0.3
    }
  });
}

async function updateStorySummary() {
  if (state.isGenerating) return;
  if (!state.project.chapters.length) {
    setStatus("organize", "请先导入小说。", true);
    return;
  }
  if (!state.project.storySummary.trim()) {
    setStatus("organize", "当前全书摘要为空。请先手动输入一版全书摘要；也可以去 DeepSeek 上传小说文本生成摘要后粘贴回来：https://chat.deepseek.com/", true);
    return;
  }
  const config = prepareLlmConfigOrSwitch();
  if (!config) return;
  const context = buildContext(state.project, {
    currentChapterId: state.project.currentChapterId || state.selectedChapterId,
    recentTextLimit: 5000,
    recallLimit: 0,
    knowledgeLimit: 0
  });

  const prompt = [
    "请基于旧梗概和最近新增/最近原文，更新全书剧情进度梗概。",
    "要求：2000个中文字符以内；描述目前故事推进到哪里、主要矛盾、当前目标、关键未解伏笔；只输出新版梗概正文，不要标题、解释或项目符号。",
    `旧梗概：\n${state.project.storySummary || "暂无"}`,
    `最近原文：\n${context.recentText || "暂无"}`
  ].join("\n\n");

  const previousStorySummary = state.project.storySummary || "";
  let storySummaryStarted = false;
  await runStreamingAiTask({
    statusTarget: "organize",
    workingMessage: "正在调用 LLM 更新全书剧情进度梗概...",
    doneMessage: "全书剧情进度梗概更新完成。",
    onDelta: (delta) => {
      if (!storySummaryStarted) {
        els.storySummary.value = "";
        storySummaryStarted = true;
      }
      els.storySummary.value = trimToLimit(els.storySummary.value + delta, STORY_SUMMARY_LIMIT);
      state.project.storySummary = els.storySummary.value;
      els.storySummary.scrollTop = els.storySummary.scrollHeight;
      renderStats();
    },
    onDone: () => {
      state.project.storySummary = trimToLimit(els.storySummary.value.trim(), STORY_SUMMARY_LIMIT);
      els.storySummary.value = state.project.storySummary;
      persistProject();
      renderStats();
    },
    onError: () => {
      state.project.storySummary = previousStorySummary;
      els.storySummary.value = previousStorySummary;
      renderStats();
    },
    request: {
      config,
      prompt,
      systemPrompt: "你是一名长篇小说剧情梗概维护助手。只输出新版梗概正文，不输出思考过程、标题或解释。",
      temperature: 0.3
    }
  });
}

async function generateStorySummaryFromChapterSummaries() {
  if (state.isGenerating) return;
  if (!state.project.chapters.length) {
    setStatus("organize", "请先导入小说。", true);
    return;
  }
  const chapterSummaries = collectChapterSummaries(state.project);
  if (!chapterSummaries.length) {
    setStatus("organize", "请先填写或生成至少一个章节摘要。", true);
    return;
  }
  const config = prepareLlmConfigOrSwitch();
  if (!config) return;

  const prompt = buildStorySummaryFromChapterSummariesPrompt(state.project, { limit: STORY_SUMMARY_LIMIT });
  const previousStorySummary = state.project.storySummary || "";
  let storySummaryStarted = false;
  await runStreamingAiTask({
    statusTarget: "organize",
    workingMessage: `正在调用 LLM 根据 ${chapterSummaries.length} 个章节摘要生成全书摘要...`,
    doneMessage: "已根据章节摘要生成全书摘要。",
    onDelta: (delta) => {
      if (!storySummaryStarted) {
        els.storySummary.value = "";
        storySummaryStarted = true;
      }
      els.storySummary.value = trimToLimit(els.storySummary.value + delta, STORY_SUMMARY_LIMIT);
      state.project.storySummary = els.storySummary.value;
      els.storySummary.scrollTop = els.storySummary.scrollHeight;
      renderStats();
    },
    onDone: () => {
      state.project.storySummary = trimToLimit(els.storySummary.value.trim(), STORY_SUMMARY_LIMIT);
      els.storySummary.value = state.project.storySummary;
      persistProject();
      renderStats();
    },
    onError: () => {
      state.project.storySummary = previousStorySummary;
      els.storySummary.value = previousStorySummary;
      renderStats();
    },
    request: {
      config,
      prompt,
      systemPrompt: "你是一名长篇小说全书梗概整理助手。只根据用户提供的章节摘要输出全书摘要，不输出思考过程、标题或解释。",
      temperature: 0.3
    }
  });
}

function addKnowledgeItem() {
  state.project.knowledgeItems.push({
    id: cryptoSafeId("knowledge"),
    type: "角色",
    title: "",
    content: "",
    keywords: [],
    isCore: false
  });
  persistProject();
  renderKnowledge();
}

function updateKnowledgeItem(id, patch) {
  const item = state.project.knowledgeItems.find((entry) => entry.id === id);
  if (!item) return;
  Object.assign(item, patch);
  state.project.updatedAt = new Date().toISOString();
  persistProject();
}

function removeKnowledgeItem(id) {
  state.project.knowledgeItems = state.project.knowledgeItems.filter((entry) => entry.id !== id);
  state.pinnedIds.delete(id);
  state.excludedIds.delete(id);
  persistProject();
  renderKnowledge();
  buildAndRenderContext();
}

function buildAndRenderContext() {
  ensureCurrentChapter();
  state.project.currentChapterId = els.currentChapterSelect.value || state.project.currentChapterId;
  state.lastContext = buildContext(state.project, {
    currentChapterId: state.project.currentChapterId,
    userRequest: buildWriteRequestText(),
    rules: els.writingRules.value.trim(),
    pinnedIds: [...state.pinnedIds],
    excludedIds: [...state.excludedIds],
    recallLimit: 0
  });
  state.lastPrompt = buildPrompt(state.lastContext);
  renderContext();
}

function refreshContextPreview() {
  if (state.isGenerating) return;
  buildAndRenderContext();
}

function buildWriteRequestText() {
  const lines = [];
  if (getWriteMode() === "new") {
    lines.push("写入方式：新增一章。");
    lines.push(`新章节标题：${els.newChapterTitle.value.trim() || "待填写"}。`);
  } else {
    lines.push("写入方式：在原章节末尾续写。");
  }
  const request = els.userRequest.value.trim();
  if (request) lines.push(`续写要求：${request}`);
  return lines.join("\n");
}

async function generateContinuation() {
  if (state.isGenerating) return;
  if (!state.project.chapters.length) {
    setGenerationStatus("请先导入小说。", true);
    return;
  }
  const config = prepareLlmConfigOrSwitch();
  if (!config) return;

  buildAndRenderContext();
  const prompt = `${state.lastPrompt}\n\n【输出要求】\n续写约1000个中文字符。只输出正文，不要标题、解释或项目符号。`;
  els.candidateText.value = "";
  await runStreamingAiTask({
    statusTarget: "generation",
    workingMessage: "正在调用 LLM 生成续写...",
    doneMessage: "生成完成。检查候选续写后，可以接受并追加。",
    interruptedMessage: "已中断生成，已返回内容保留在候选续写中。",
    onDelta: appendCandidateDelta,
    request: { config, prompt }
  });
}

function stopGeneration() {
  state.generationController?.abort();
}

function setGeneratingState(isGenerating) {
  state.isGenerating = isGenerating;
  els.generateButton.disabled = isGenerating;
  els.stopGenerationButton.disabled = !isGenerating;
  els.acceptGenerationButton.disabled = isGenerating;
  els.buildContextButton.disabled = isGenerating;
  els.generateBookSummaryButton.disabled = isGenerating;
  els.updateSummaryButton.disabled = isGenerating;
  els.stopSummaryButton.disabled = !isGenerating;
  els.draftSummaryButton.disabled = isGenerating || !getSelectedChapter();
  els.stopChapterSummaryButton.disabled = !isGenerating;
}

function appendCandidateDelta(delta) {
  if (!delta) return;
  els.candidateText.value += delta;
  els.candidateText.scrollTop = els.candidateText.scrollHeight;
}

function prepareLlmConfigOrSwitch() {
  saveLlmConfigFromForm(false);
  const config = state.llmConfig;
  if (!config.baseUrl || !config.model || !config.apiKey) {
    setGenerationStatus("请先在 LLM 配置页填写接口地址、模型和 API Key。", true);
    setStatus("organize", "请先在 LLM 配置页填写接口地址、模型和 API Key。", true);
    switchTab("settings");
    return null;
  }
  return config;
}

async function runStreamingAiTask({ statusTarget, workingMessage, doneMessage, interruptedMessage = "已中断生成，已返回内容会保留。", onDelta, onDone, onError, request }) {
  state.generationController = new AbortController();
  state.thinkFilter = createThinkFilter();
  let visibleOutput = "";
  setGeneratingState(true);
  setStatus(statusTarget, workingMessage);

  try {
    await callChatCompletionStream(request.config, request.prompt, {
      signal: state.generationController.signal,
      systemPrompt: request.systemPrompt,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      onDelta: (delta) => {
        const visibleDelta = state.thinkFilter.push(delta);
        visibleOutput += visibleDelta;
        if (visibleDelta) onDelta(visibleDelta);
      }
    });
    const tail = state.thinkFilter.flush();
    visibleOutput += tail;
    if (tail) onDelta(tail);
    if (!visibleOutput.trim()) {
      throw new Error("接口完成但没有返回可显示的正文。");
    }
    onDone?.();
    setStatus(statusTarget, doneMessage);
  } catch (error) {
    if (error.name === "AbortError") {
      const tail = state.thinkFilter.flush();
      visibleOutput += tail;
      if (tail) onDelta(tail);
      onDone?.();
      setStatus(statusTarget, interruptedMessage);
    } else {
      onError?.(error);
      setStatus(statusTarget, `${workingMessage.replace(/^正在调用 LLM /, "")}失败：${error.message}`, true);
    }
  } finally {
    state.generationController = null;
    setGeneratingState(false);
  }
}

async function callChatCompletionStream(config, prompt, { signal, onDelta, systemPrompt, maxTokens, temperature }) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: Number(temperature ?? config.temperature ?? 0.8),
      max_tokens: Number(maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS),
      stream: true,
      messages: [
        { role: "system", content: systemPrompt || config.systemPrompt || DEFAULT_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    const message = data?.error?.message || data?.message || data?.raw || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  if (!response.body) throw new Error("当前环境不支持流式读取响应。");
  await readServerSentEvents(response.body, onDelta);
}

async function readServerSentEvents(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let received = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";

    for (const eventText of events) {
      const delta = parseSseDelta(eventText);
      if (delta === "[DONE]") return;
      if (delta) {
        received = true;
        onDelta(delta);
      }
    }
  }

  const tail = parseSseDelta(buffer);
  if (tail && tail !== "[DONE]") {
    received = true;
    onDelta(tail);
  }
  if (!received) throw new Error("接口未返回可用文本。");
}

function parseSseDelta(eventText) {
  const dataLines = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return "";

  const data = dataLines.join("\n");
  if (data === "[DONE]") return "[DONE]";

  try {
    const parsed = JSON.parse(data);
    return parsed?.choices?.[0]?.delta?.content
      || parsed?.choices?.[0]?.message?.content
      || parsed?.choices?.[0]?.text
      || "";
  } catch {
    return "";
  }
}

function setGenerationStatus(message, isError = false) {
  els.generationStatus.textContent = message || "";
  els.generationStatus.classList.toggle("error", isError);
}

function setStatus(target, message, isError = false) {
  const element = target === "organize" ? els.organizeStatus : els.generationStatus;
  element.textContent = message || "";
  element.classList.toggle("error", isError);
}

async function acceptCandidate() {
  const content = els.candidateText.value.trim();
  const chapterId = state.project.currentChapterId;
  if (!content || !chapterId) return;
  const context = state.lastContext || buildContext(state.project);
  if (getWriteMode() === "new") {
    const title = els.newChapterTitle.value.trim();
    if (!title) {
      setGenerationStatus("请填写新章节标题。", true);
      return;
    }
    const chapter = acceptGenerationAsNewChapter(state.project, chapterId, title, content, context);
    state.selectedChapterId = chapter.id;
  } else {
    acceptGeneration(state.project, chapterId, content, context);
    state.selectedChapterId = chapterId;
  }
  persistProject();
  await writeBoundTxtFile();
  els.candidateText.value = "";
  render();
  switchTab("organize");
}

function exportTxt() {
  if (!state.project.chapters.length) {
    setStatus("organize", "没有可导出的章节。", true);
    return;
  }
  const blob = new Blob([serializeProjectToTxt(state.project)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(state.project.title || "novel")}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

async function bindWritableTxtFile() {
  if (!("showSaveFilePicker" in window)) {
    setStatus("organize", "当前浏览器不支持直接写入本地文件。请使用“导出 TXT”。", true);
    return;
  }
  try {
    state.writableFileHandle = await window.showSaveFilePicker({
      suggestedName: `${sanitizeFilename(state.project.title || "novel")}.txt`,
      types: [{ description: "Text", accept: { "text/plain": [".txt"] } }]
    });
    els.fileWriteStatus.textContent = `已绑定：${state.writableFileHandle.name}`;
    await writeBoundTxtFile();
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus("organize", `绑定写入文件失败：${error.message}`, true);
    }
  }
}

async function writeBoundTxtFile() {
  if (!state.writableFileHandle) return;
  try {
    const writable = await state.writableFileHandle.createWritable();
    await writable.write(serializeProjectToTxt(state.project));
    await writable.close();
    els.fileWriteStatus.textContent = `已写入：${state.writableFileHandle.name}`;
  } catch (error) {
    setStatus("organize", `写入 TXT 失败：${error.message}`, true);
  }
}

function sanitizeFilename(name) {
  return String(name || "novel").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function getWriteMode() {
  return els.writeModeInputs.find((input) => input.checked)?.value || "append";
}

function save() {
  persistProject();
}

function persistProject() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
}

function saveLlmConfigFromForm(showStatus = true) {
  state.llmConfig = {
    baseUrl: els.llmBaseUrl.value.trim(),
    model: els.llmModel.value.trim(),
    apiKey: els.llmApiKey.value.trim(),
    temperature: Number(els.llmTemperature.value || 0.8),
    maxTokens: Number(els.llmMaxTokens.value || DEFAULT_MAX_TOKENS),
    systemPrompt: els.llmSystemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT
  };
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(state.llmConfig));
  if (showStatus) setGenerationStatus("LLM 配置已保存。");
}

function loadLlmConfig() {
  const fallback = {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
    temperature: 0.8,
    maxTokens: DEFAULT_MAX_TOKENS,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  };
  const raw = localStorage.getItem(LLM_CONFIG_KEY);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    localStorage.removeItem(LLM_CONFIG_KEY);
    return fallback;
  }
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    state.project = JSON.parse(raw);
    ensureCurrentChapter();
    state.selectedChapterId = state.project.currentChapterId;
    state.pinnedIds = new Set(state.project.contextPins || []);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function clearAll() {
  if (!confirm("确定清空当前项目吗？这会删除浏览器里保存的章节、正文、摘要和生成记录，但不会删除原始文件或 LLM 配置。")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.project = createProject("未命名小说", []);
  state.selectedChapterId = null;
  state.excludedIds.clear();
  state.pinnedIds.clear();
  state.lastContext = null;
  state.lastPrompt = "";
  render();
}

function render() {
  ensureCurrentChapter();
  els.projectTitle.value = state.project.title || "未命名小说";
  els.storySummary.value = state.project.storySummary || "";
  renderLlmConfig();
  renderWriteMode();
  renderStats();
  renderChapterList();
  renderSelectedChapter();
  renderReader();
  renderKnowledge();
  renderChapterSelect();
  renderContext();
  renderHistory();
  renderReaderFocusMode();
  enhanceTextareas();
}

function renderWriteMode() {
  const isNewChapter = getWriteMode() === "new";
  els.newChapterTitleWrap.classList.toggle("hidden", !isNewChapter);
  els.acceptGenerationButton.textContent = isNewChapter ? "接受并新增章节" : "接受并追加";
}

function renderLlmConfig() {
  els.llmBaseUrl.value = state.llmConfig.baseUrl || "";
  els.llmModel.value = state.llmConfig.model || "";
  els.llmApiKey.value = state.llmConfig.apiKey || "";
  els.llmTemperature.value = state.llmConfig.temperature ?? 0.8;
  els.llmMaxTokens.value = state.llmConfig.maxTokens ?? DEFAULT_MAX_TOKENS;
  els.llmSystemPrompt.value = state.llmConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

function renderStats() {
  const chapters = state.project.chapters || [];
  els.chapterCount.textContent = chapters.length.toLocaleString("zh-CN");
  els.totalChars.textContent = chapters.reduce((sum, chapter) => sum + (chapter.charCount || 0), 0).toLocaleString("zh-CN");
  els.summaryCount.textContent = `${Array.from(state.project.storySummary || "").length} / ${STORY_SUMMARY_LIMIT}`;
  els.splitStatus.textContent = chapters.length ? "已完成本地切分" : "尚未导入";
}

function renderChapterList() {
  const chapters = state.project.chapters || [];
  els.chapterList.innerHTML = chapters.map((chapter) => `
    <article class="chapter-row ${chapter.id === state.selectedChapterId ? "active" : ""}" data-id="${chapter.id}">
      <div>
        <strong>${escapeHtml(chapter.order)}. ${escapeHtml(chapter.title)}</strong>
        <small>${(chapter.charCount || 0).toLocaleString("zh-CN")} 字</small>
      </div>
      <span class="badge ${chapter.summary ? "ready" : ""}">${chapter.summary ? "有摘要" : "缺摘要"}</span>
    </article>
  `).join("");

  els.chapterList.querySelectorAll(".chapter-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedChapterId = row.dataset.id;
      renderChapterList();
      renderSelectedChapter();
    });
  });
}

function renderReader() {
  const chapters = state.project.chapters || [];
  els.readerStatus.textContent = chapters.length
    ? `${chapters.length.toLocaleString("zh-CN")} 章，${chapters.reduce((sum, chapter) => sum + (chapter.charCount || 0), 0).toLocaleString("zh-CN")} 字`
    : "尚未导入";

  els.readerChapterSelect.innerHTML = chapters.length
    ? chapters.map((chapter) => (
      `<option value="${chapter.id}" ${chapter.id === state.selectedChapterId ? "selected" : ""}>${chapter.order}. ${escapeHtml(chapter.title)}</option>`
    )).join("")
    : `<option value="">暂无章节</option>`;
  els.readerChapterSelect.disabled = chapters.length === 0;

  els.readerChapterList.innerHTML = chapters.length
    ? chapters.map((chapter) => `
      <button class="reader-toc-item ${chapter.id === state.selectedChapterId ? "active" : ""}" data-id="${chapter.id}" type="button">
        <strong>${escapeHtml(chapter.order)}. ${escapeHtml(chapter.title)}</strong>
        <small>${(chapter.charCount || 0).toLocaleString("zh-CN")} 字</small>
      </button>
    `).join("")
    : `<article class="reader-empty">导入 TXT / MD 后可在这里阅读全文。</article>`;

  els.readerContent.innerHTML = chapters.length
    ? chapters.map((chapter) => `
      <article id="${readerChapterDomId(chapter.id)}" class="reader-chapter" data-id="${chapter.id}">
        <h3>${escapeHtml(chapter.title)}</h3>
        <div class="reader-body">${formatReaderBody(chapter.body)}</div>
      </article>
    `).join("")
    : `<article class="reader-empty">暂无正文。</article>`;

  els.readerChapterList.querySelectorAll(".reader-toc-item").forEach((button) => {
    button.addEventListener("click", () => jumpToReaderChapter(button.dataset.id));
  });
  renderReaderTocActive();
}

function jumpToReaderChapter(chapterId) {
  if (!chapterId) return;
  setReaderActiveChapter(chapterId, { scrollToc: false });
  const target = els.readerContent.querySelector(`#${readerChapterDomId(chapterId)}`);
  if (target) {
    els.readerContent.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  }
}

function handleReaderScroll() {
  if (state.readerScrollFrame) return;
  state.readerScrollFrame = requestAnimationFrame(() => {
    state.readerScrollFrame = null;
    const chapterId = findVisibleReaderChapterId();
    if (chapterId) setReaderActiveChapter(chapterId, { scrollToc: true });
  });
}

function findVisibleReaderChapterId() {
  const chapters = [...els.readerContent.querySelectorAll(".reader-chapter")];
  if (!chapters.length) return null;
  const scrollTop = els.readerContent.scrollTop;
  const threshold = 80;
  let current = chapters[0];
  for (const chapter of chapters) {
    if (chapter.offsetTop - threshold <= scrollTop) {
      current = chapter;
    } else {
      break;
    }
  }
  return current.dataset.id;
}

function setReaderActiveChapter(chapterId, { scrollToc = false } = {}) {
  if (!chapterId || state.selectedChapterId === chapterId) return;
  state.selectedChapterId = chapterId;
  if (els.readerChapterSelect.value !== chapterId) {
    els.readerChapterSelect.value = chapterId;
  }
  renderChapterList();
  renderSelectedChapter();
  renderReaderTocActive();
  if (scrollToc) {
    els.readerChapterList.querySelector(`[data-id="${cssEscape(chapterId)}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function renderReaderTocActive() {
  els.readerChapterList.querySelectorAll(".reader-toc-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.id === state.selectedChapterId);
  });
}

function toggleReaderFocusMode() {
  state.isReaderFocusMode = !state.isReaderFocusMode;
  renderReaderFocusMode();
}

function renderReaderFocusMode() {
  els.appShell.classList.toggle("reader-focus-mode", state.isReaderFocusMode);
  els.readerFocusButton.textContent = state.isReaderFocusMode ? "退出全屏" : "内容全屏";
  els.readerFocusButton.setAttribute("aria-pressed", String(state.isReaderFocusMode));
}

function readerChapterDomId(chapterId) {
  return `reader-chapter-${String(chapterId || "").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function formatReaderBody(body) {
  const text = String(body || "").trim();
  if (!text) return "<p>本章暂无正文。</p>";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function renderSelectedChapter() {
  const chapter = getSelectedChapter();
  els.chapterTitle.value = chapter?.title || "";
  els.chapterSummary.value = chapter?.summary || "";
  els.chapterBody.value = chapter?.body || "";
  els.draftSummaryButton.disabled = !chapter;
}

function renderKnowledge() {
  if (!els.knowledgeList) return;
  const items = state.project.knowledgeItems || [];
  els.knowledgeList.innerHTML = items.map((item) => `
    <article class="knowledge-row" data-id="${item.id}">
      <select data-field="type">
        ${["角色", "地点", "势力", "世界观", "规则设定"].map((type) => `<option ${item.type === type ? "selected" : ""}>${type}</option>`).join("")}
      </select>
      <input class="field" data-field="title" value="${escapeAttr(item.title)}" placeholder="标题">
      <textarea data-field="content" rows="3" placeholder="内容">${escapeHtml(item.content)}</textarea>
      <div>
        <label><input type="checkbox" data-field="isCore" ${item.isCore ? "checked" : ""}> 核心</label>
        <input class="field" data-field="keywords" value="${escapeAttr((item.keywords || []).join("、"))}" placeholder="关键词">
        <button class="ghost" data-action="remove">删除</button>
      </div>
    </article>
  `).join("");

  els.knowledgeList.querySelectorAll(".knowledge-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelectorAll("[data-field]").forEach((field) => {
      field.addEventListener("input", () => {
        const key = field.dataset.field;
        const value = key === "isCore"
          ? field.checked
          : key === "keywords"
            ? field.value.split(/[、,\s]+/).map((item) => item.trim()).filter(Boolean)
            : field.value;
        updateKnowledgeItem(id, { [key]: value });
      });
      field.addEventListener("change", () => field.dispatchEvent(new Event("input")));
    });
    row.querySelector("[data-action='remove']").addEventListener("click", () => removeKnowledgeItem(id));
  });
  enhanceTextareas();
}

function renderChapterSelect() {
  ensureCurrentChapter();
  const chapters = state.project.chapters || [];
  els.currentChapterSelect.innerHTML = chapters.map((chapter) => (
    `<option value="${chapter.id}" ${chapter.id === state.project.currentChapterId ? "selected" : ""}>${chapter.order}. ${escapeHtml(chapter.title)}</option>`
  )).join("");
}

function renderContext() {
  if (!state.lastContext) {
    els.contextPreview.innerHTML = `<article class="context-module"><p>暂无上下文。</p></article>`;
    els.promptPreview.textContent = "";
    return;
  }

  els.contextPreview.innerHTML = [
    contextModule("1. 本次续写要求", state.lastContext.userRequest || "未填写", "必定发送"),
    contextModule("2. 最近原文", state.lastContext.recentText || "暂无", `${state.lastContext.sources.recentTextChapterIds.length} 个章节，${countTextChars(state.lastContext.recentText).toLocaleString("zh-CN")} 字，必定发送`),
    contextModule("3. 全书摘要", state.lastContext.storySummary || "未填写", "最多 2000 字，必定发送"),
    contextListModule("4. 最近章节摘要", state.lastContext.recentSummaries, "最近 3 章内已有摘要的章节会发送", (chapter) => `${chapter.order}. ${chapter.title}\n${chapter.summary}`),
    contextListModule("5. 相关知识库", state.lastContext.knowledgeItems, "可选模块；命中当前上下文关键词时发送", (item) => `${item.type || "设定"}：${item.title}\n${item.content}`),
    contextModule("6. 写作规则", state.lastContext.rules || "未填写", "填写后发送")
  ].join("");
  els.promptPreview.textContent = state.lastPrompt;
}

function contextModule(title, body, meta = "") {
  return `
    <details class="context-module">
      <summary class="context-module-head">
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
      </summary>
      <p>${escapeHtml(body || "").replace(/\n/g, "<br>")}</p>
    </details>
  `;
}

function contextListModule(title, items, meta, formatter) {
  const body = items.length
    ? items.map((item) => formatter(item)).join("\n\n")
    : "本次不会发送。";
  return contextModule(title, body, meta);
}

function renderHistory() {
  if (!els.historyList || !els.historyCount) return;
  const history = state.project.generationHistory || [];
  els.historyCount.textContent = `${history.length} 条`;
  els.historyList.innerHTML = history.length ? history.map((item) => `
    <article class="history-row">
      <small>${escapeHtml(new Date(item.createdAt).toLocaleString("zh-CN"))}</small>
      <p>${escapeHtml(item.content).replace(/\n/g, "<br>")}</p>
    </article>
  `).join("") : `<article class="history-row"><p>暂无生成历史。</p></article>`;
}

function getSelectedChapter() {
  return state.project.chapters.find((chapter) => chapter.id === state.selectedChapterId) || null;
}

function ensureCurrentChapter() {
  const chapters = state.project.chapters || [];
  if (chapters.length === 0) {
    state.project.currentChapterId = null;
    state.selectedChapterId = null;
    return;
  }
  const currentExists = chapters.some((chapter) => chapter.id === state.project.currentChapterId);
  if (!currentExists) {
    state.project.currentChapterId = chapters.at(-1).id;
  }
  const selectedExists = chapters.some((chapter) => chapter.id === state.selectedChapterId);
  if (!selectedExists) {
    state.selectedChapterId = state.project.currentChapterId;
  }
}

function setCurrentChapterToLatest() {
  const latestChapter = state.project.chapters?.at(-1);
  if (!latestChapter) return;
  state.project.currentChapterId = latestChapter.id;
  state.selectedChapterId = latestChapter.id;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function enhanceTextareas() {
  document.querySelectorAll("textarea").forEach((textarea) => {
    if (textarea.dataset.expandReady === "true" || textarea.id === "expandedTextEditor") return;
    textarea.dataset.expandReady = "true";
    const wrapper = document.createElement("span");
    wrapper.className = "textarea-wrap";
    textarea.parentNode.insertBefore(wrapper, textarea);
    wrapper.appendChild(textarea);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "textarea-expand";
    button.textContent = "⛶";
    button.title = "放大编辑";
    button.setAttribute("aria-label", "放大编辑");
    button.addEventListener("click", () => openExpandedText(textarea));
    wrapper.appendChild(button);
  });
}

function openExpandedText(textarea) {
  state.expandedTextarea = textarea;
  els.textEditorTitle.textContent = getTextareaTitle(textarea);
  els.expandedTextEditor.value = textarea.value;
  els.textEditorDialog.showModal();
  els.expandedTextEditor.focus();
}

function applyExpandedText(event) {
  event.preventDefault();
  if (state.expandedTextarea) {
    state.expandedTextarea.value = els.expandedTextEditor.value;
    state.expandedTextarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  els.textEditorDialog.close();
}

function getTextareaTitle(textarea) {
  const label = textarea.closest("label");
  if (label) {
    return label.childNodes[0]?.textContent?.trim() || "放大编辑";
  }
  if (textarea.dataset.field === "content") return "知识库内容";
  return "放大编辑";
}
