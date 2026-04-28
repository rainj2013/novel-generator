const CHAPTER_TITLE_PATTERNS = [
  /^#{1,6}\s+(.+)$/,
  /^第[0-9零〇一二两三四五六七八九十百千万]+[章节回卷部集篇].{0,60}$/,
  /^chapter\s+[0-9ivxlcdm]+[\s:：.-].{0,80}$/i,
  /^chapter\s+[0-9ivxlcdm]+$/i
];

const DEFAULT_PSEUDO_CHAPTER_SIZE = 8000;
const MIN_PSEUDO_CHAPTER_SIZE = 6000;
const MAX_PSEUDO_CHAPTER_SIZE = 10000;
const STORY_SUMMARY_LIMIT = 2000;

export function trimToLimit(text = "", limit = 500) {
  return Array.from(String(text)).slice(0, limit).join("");
}

export function countTextChars(text = "") {
  return Array.from(String(text).replace(/\s+/g, "")).length;
}

export function isChapterTitle(line = "") {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  return CHAPTER_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function splitNovel(rawText, options = {}) {
  const text = String(rawText || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const titleHits = [];
  let offset = 0;

  for (const line of lines) {
    if (isChapterTitle(line)) {
      titleHits.push({ title: normalizeTitle(line), start: offset });
    }
    offset += line.length + 1;
  }

  if (titleHits.length > 0) {
    return splitByDetectedTitles(text, titleHits);
  }

  return splitIntoPseudoChapters(text, options);
}

function normalizeTitle(line) {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function splitByDetectedTitles(text, titleHits) {
  const chapters = [];

  if (titleHits[0].start > 0) {
    const body = text.slice(0, titleHits[0].start).trim();
    if (body) {
      chapters.push(createChapter(chapters.length, "序章", body));
    }
  }

  for (let i = 0; i < titleHits.length; i += 1) {
    const current = titleHits[i];
    const next = titleHits[i + 1];
    const section = text.slice(current.start, next ? next.start : text.length).trim();
    const body = stripLeadingTitle(section, current.title);
    chapters.push(createChapter(chapters.length, current.title, body));
  }

  return chapters;
}

function stripLeadingTitle(section, title) {
  const lines = section.split("\n");
  if (normalizeTitle(lines[0] || "") === title) {
    return lines.slice(1).join("\n").trim();
  }
  return section.trim();
}

function splitIntoPseudoChapters(text, options) {
  const targetSize = options.targetSize || DEFAULT_PSEUDO_CHAPTER_SIZE;
  const minSize = options.minSize || MIN_PSEUDO_CHAPTER_SIZE;
  const maxSize = options.maxSize || MAX_PSEUDO_CHAPTER_SIZE;
  const chapters = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= maxSize && chapters.length > 0) {
      const body = text.slice(cursor).trim();
      if (body) chapters.push(createChapter(chapters.length, `伪章节 ${chapters.length + 1}`, body));
      break;
    }

    const desiredEnd = Math.min(cursor + targetSize, text.length);
    const minEnd = Math.min(cursor + minSize, text.length);
    const maxEnd = Math.min(cursor + maxSize, text.length);
    let end = findParagraphBoundary(text, desiredEnd, minEnd, maxEnd);
    if (end <= cursor) end = maxEnd;

    const body = text.slice(cursor, end).trim();
    if (body) chapters.push(createChapter(chapters.length, `伪章节 ${chapters.length + 1}`, body));
    cursor = end;
  }

  return chapters;
}

function findParagraphBoundary(text, desiredEnd, minEnd, maxEnd) {
  const forward = text.slice(desiredEnd, maxEnd).search(/\n\s*\n|[。！？!?]\n/);
  if (forward >= 0) return desiredEnd + forward + 1;

  const backwardText = text.slice(minEnd, desiredEnd);
  const matches = [...backwardText.matchAll(/\n\s*\n|[。！？!?]\n/g)];
  if (matches.length > 0) {
    return minEnd + matches[matches.length - 1].index + 1;
  }

  return desiredEnd;
}

function createChapter(index, title, body) {
  return {
    id: cryptoSafeId("chapter"),
    order: index + 1,
    title,
    body,
    charCount: countTextChars(body),
    summary: "",
    summaryStatus: "missing"
  };
}

export function createProject(title, chapters = []) {
  const now = new Date().toISOString();
  return {
    id: cryptoSafeId("project"),
    title: title || "未命名小说",
    storySummary: "",
    currentChapterId: chapters.at(-1)?.id || null,
    chapters,
    knowledgeItems: [],
    generationHistory: [],
    contextPins: [],
    createdAt: now,
    updatedAt: now
  };
}

export function serializeProjectToTxt(project) {
  const lines = [];
  for (const chapter of project.chapters || []) {
    if (chapter.title) lines.push(chapter.title.trim());
    if (chapter.body) lines.push(String(chapter.body).trim());
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function summarizeChapterDraft(chapter) {
  const body = String(chapter?.body || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const sentences = body.split(/(?<=[。！？!?])/).map((item) => item.trim()).filter(Boolean);
  const selected = [sentences[0], sentences[Math.floor(sentences.length / 2)], sentences[sentences.length - 1]]
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .join("");
  return trimToLimit(selected || body, 300);
}

export function updateStorySummaryDraft(oldSummary = "", recentContent = "") {
  const recentDraft = summarizeChapterDraft({ body: recentContent });
  const merged = [
    String(oldSummary || "").trim(),
    recentDraft && `最近进展：${recentDraft}`
  ].filter(Boolean).join("\n");
  return trimToLimit(merged, STORY_SUMMARY_LIMIT);
}

export function extractKeywords({ recentText = "", chapters = [], knowledgeItems = [], currentChapterId = null } = {}) {
  const keywords = new Set();
  const source = `${recentText}\n${chapters.map((chapter) => `${chapter.title}\n${chapter.summary}`).join("\n")}`;

  for (const item of knowledgeItems) {
    addKeyword(keywords, item.title);
    for (const keyword of item.keywords || []) addKeyword(keywords, keyword);
  }

  const chineseEntities = source.match(/[一-龥]{2,8}/g) || [];
  const counts = new Map();
  for (const word of chineseEntities) {
    if (STOP_WORDS.has(word) || word.length < 2) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .forEach(([word]) => addKeyword(keywords, word));

  const latinWords = source.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
  latinWords.slice(0, 24).forEach((word) => addKeyword(keywords, word));

  const current = chapters.find((chapter) => chapter.id === currentChapterId);
  if (current) addKeyword(keywords, current.title);

  return [...keywords].slice(0, 40);
}

function addKeyword(set, value) {
  const keyword = String(value || "").trim();
  if (keyword && keyword.length <= 30) set.add(keyword);
}

const STOP_WORDS = new Set([
  "他们", "我们", "你们", "这个", "那个", "自己", "没有", "只是", "已经", "还是", "然后", "因为",
  "所以", "但是", "如果", "时候", "什么", "一个", "一些", "这里", "那里", "可以", "不是"
]);

export function buildContext(project, options = {}) {
  const chapters = project.chapters || [];
  if (chapters.length === 0) {
    const pinnedIds = new Set(options.pinnedIds || project.contextPins || []);
    const excludedIds = new Set(options.excludedIds || []);
    const knowledgeItems = selectKnowledgeItems(project.knowledgeItems || [], [], pinnedIds, excludedIds, options.knowledgeLimit ?? 6);
    return {
      userRequest: options.userRequest || "",
      storySummary: trimToLimit(project.storySummary || "", STORY_SUMMARY_LIMIT),
      recentText: "",
      recentSummaries: [],
      recalledChapters: [],
      knowledgeItems,
      keywords: [],
      rules: options.rules || "",
      sources: {
        recentTextChapterIds: [],
        recentSummaryIds: [],
        recalledChapterIds: [],
        knowledgeItemIds: knowledgeItems.map((item) => item.id)
      }
    };
  }
  const currentChapterId = options.currentChapterId || project.currentChapterId || chapters.at(-1)?.id;
  const currentIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === currentChapterId));
  const recentTextLimit = options.recentTextLimit ?? 5000;
  const recentSummaryCount = options.recentSummaryCount ?? 3;
  const recentText = collectRecentText(chapters, currentIndex, recentTextLimit);
  const recentSummaries = collectRecentSummaries(chapters, currentIndex, recentSummaryCount);
  const keywords = extractKeywords({
    recentText,
    chapters,
    knowledgeItems: project.knowledgeItems || [],
    currentChapterId
  });
  const pinnedIds = new Set(options.pinnedIds || project.contextPins || []);
  const excludedIds = new Set(options.excludedIds || []);
  const recallLimit = options.recallLimit ?? 0;
  const recalledChapters = recallLimit > 0
    ? recallChapters({
      chapters,
      currentIndex,
      keywords,
      recentSummaryIds: recentSummaries.map((chapter) => chapter.id),
      pinnedIds,
      excludedIds,
      limit: recallLimit
    })
    : [];
  const knowledgeItems = selectKnowledgeItems(project.knowledgeItems || [], keywords, pinnedIds, excludedIds, options.knowledgeLimit ?? 6);

  return {
    userRequest: options.userRequest || "",
    storySummary: trimToLimit(project.storySummary || "", STORY_SUMMARY_LIMIT),
    recentText,
    recentSummaries,
    recalledChapters,
    knowledgeItems,
    keywords,
    rules: options.rules || "",
    sources: {
      recentTextChapterIds: collectRecentTextChapterIds(chapters, currentIndex, recentTextLimit),
      recentSummaryIds: recentSummaries.map((chapter) => chapter.id),
      recalledChapterIds: recalledChapters.map((chapter) => chapter.id),
      knowledgeItemIds: knowledgeItems.map((item) => item.id)
    }
  };
}

function collectRecentText(chapters, currentIndex, limit) {
  let text = "";
  for (let i = currentIndex; i >= 0 && countTextChars(text) < limit; i -= 1) {
    text = `${chapters[i].body}\n${text}`.trim();
  }
  return trimFromEndByChars(text, limit);
}

function collectRecentTextChapterIds(chapters, currentIndex, limit) {
  const ids = [];
  let total = 0;
  for (let i = currentIndex; i >= 0 && total < limit; i -= 1) {
    ids.unshift(chapters[i].id);
    total += countTextChars(chapters[i].body);
  }
  return ids;
}

function trimFromEndByChars(text, limit) {
  const chars = Array.from(text);
  return chars.length <= limit ? text : chars.slice(chars.length - limit).join("");
}

function collectRecentSummaries(chapters, currentIndex, count) {
  const start = Math.max(0, currentIndex - count + 1);
  return chapters.slice(start, currentIndex + 1).filter((chapter) => chapter.summary.trim());
}

function recallChapters({ chapters, currentIndex, keywords, recentSummaryIds, pinnedIds, excludedIds, limit }) {
  const recentIds = new Set(recentSummaryIds);
  const candidates = chapters
    .filter((chapter, index) => index <= currentIndex)
    .filter((chapter) => chapter.summary.trim())
    .filter((chapter) => !recentIds.has(chapter.id))
    .filter((chapter) => !excludedIds.has(chapter.id))
    .map((chapter) => {
      const haystack = `${chapter.title}\n${chapter.summary}`;
      const hits = keywords.filter((keyword) => haystack.includes(keyword));
      const pinnedBoost = pinnedIds.has(chapter.id) ? 100 : 0;
      return { ...chapter, hitKeywords: hits, score: hits.length + pinnedBoost };
    })
    .filter((chapter) => chapter.score > 0)
    .sort((a, b) => b.score - a.score || b.order - a.order);

  return candidates.slice(0, limit);
}

function selectKnowledgeItems(items, keywords, pinnedIds, excludedIds, limit) {
  return items
    .filter((item) => !excludedIds.has(item.id))
    .map((item) => {
      const haystack = `${item.title}\n${item.content}\n${(item.keywords || []).join(" ")}`;
      const hits = keywords.filter((keyword) => haystack.includes(keyword));
      const score = hits.length + (item.isCore ? 10 : 0) + (pinnedIds.has(item.id) ? 100 : 0);
      return { ...item, hitKeywords: hits, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildPrompt(context) {
  return [
    context.userRequest && `【本次续写要求】\n${context.userRequest}`,
    context.recentText && `【最近原文】\n${context.recentText}`,
    context.storySummary && `【全书剧情进度梗概】\n${context.storySummary}`,
    context.recentSummaries.length && `【最近章节摘要】\n${context.recentSummaries.map(formatChapterSummary).join("\n")}`,
    context.knowledgeItems.length && `【相关知识库】\n${context.knowledgeItems.map(formatKnowledgeItem).join("\n")}`,
    context.rules && `【写作规则】\n${context.rules}`
  ].filter(Boolean).join("\n\n");
}

function formatChapterSummary(chapter) {
  const hits = chapter.hitKeywords?.length ? `（命中：${chapter.hitKeywords.join("、")}）` : "";
  return `${chapter.order}. ${chapter.title}${hits}\n${chapter.summary}`;
}

function formatKnowledgeItem(item) {
  return `${item.type || "设定"}：${item.title}\n${item.content}`;
}

export function acceptGeneration(project, chapterId, content, context, revisionRequest = "") {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error("Chapter not found");
  chapter.body = `${chapter.body.trim()}\n\n${String(content || "").trim()}`.trim();
  chapter.charCount = countTextChars(chapter.body);
  project.generationHistory.push({
    id: cryptoSafeId("generation"),
    chapterId,
    content,
    revisionRequest,
    accepted: true,
    contextSources: context.sources,
    createdAt: new Date().toISOString()
  });
  project.updatedAt = new Date().toISOString();
  return project;
}

export function acceptGenerationAsNewChapter(project, afterChapterId, title, content, context, revisionRequest = "") {
  const insertIndex = Math.max(0, project.chapters.findIndex((item) => item.id === afterChapterId)) + 1;
  const chapter = {
    id: cryptoSafeId("chapter"),
    order: insertIndex + 1,
    title: title || `第 ${insertIndex + 1} 章`,
    body: String(content || "").trim(),
    charCount: countTextChars(content || ""),
    summary: "",
    summaryStatus: "missing"
  };

  project.chapters.splice(insertIndex, 0, chapter);
  project.chapters.forEach((item, index) => {
    item.order = index + 1;
  });
  project.currentChapterId = chapter.id;
  project.generationHistory.push({
    id: cryptoSafeId("generation"),
    chapterId: chapter.id,
    content,
    revisionRequest,
    accepted: true,
    target: "new_chapter",
    contextSources: context.sources,
    createdAt: new Date().toISOString()
  });
  project.updatedAt = new Date().toISOString();
  return chapter;
}

export function createThinkFilter() {
  let buffer = "";
  let inThink = false;
  const openTag = "<think>";
  const closeTag = "</think>";
  const carryLength = Math.max(openTag.length, closeTag.length) - 1;

  return {
    push(chunk) {
      buffer += String(chunk || "");
      let output = "";

      while (buffer) {
        const lower = buffer.toLowerCase();
        if (inThink) {
          const closeIndex = lower.indexOf(closeTag);
          if (closeIndex === -1) {
            buffer = buffer.slice(Math.max(0, buffer.length - carryLength));
            return output;
          }
          buffer = buffer.slice(closeIndex + closeTag.length);
          inThink = false;
          continue;
        }

        const openIndex = lower.indexOf(openTag);
        if (openIndex === -1) {
          const safeLength = Math.max(0, buffer.length - carryLength);
          output += buffer.slice(0, safeLength);
          buffer = buffer.slice(safeLength);
          return output;
        }

        output += buffer.slice(0, openIndex);
        buffer = buffer.slice(openIndex + openTag.length);
        inThink = true;
      }

      return output;
    },
    flush() {
      if (inThink) {
        buffer = "";
        return "";
      }
      const output = buffer;
      buffer = "";
      return output;
    }
  };
}

export function filterThinkTagsForTest(chunks) {
  const filter = createThinkFilter();
  return chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
}

export function cryptoSafeId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}
