import assert from "node:assert/strict";
import {
  acceptGeneration,
  acceptGenerationAsNewChapter,
  buildStorySummaryFromChapterSummariesPrompt,
  buildContext,
  buildPrompt,
  collectChapterSummaries,
  createProject,
  serializeProjectToTxt,
  splitNovel,
  summarizeChapterDraft,
  trimToLimit,
  updateStorySummaryDraft
} from "../src/novel-core.js";

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("splits Chinese chapter titles without any LLM call", () => {
  const chapters = splitNovel("第1章 初见\n林舟到了青石镇。\n\n第2章 风起\n沈月发现密信。");
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, "第1章 初见");
  assert.match(chapters[1].body, /沈月/);
});

run("splits Markdown chapter titles", () => {
  const chapters = splitNovel("# Chapter 1\nA\n\n## Chapter 2\nB");
  assert.equal(chapters.length, 2);
  assert.equal(chapters[1].title, "Chapter 2");
});

run("new project defaults current chapter to latest chapter", () => {
  const chapters = splitNovel("第1章 开始\nA\n\n第2章 最新\nB");
  const project = createProject("测试书", chapters);
  assert.equal(project.currentChapterId, chapters[1].id);
});

run("creates pseudo chapters when titles are missing", () => {
  const text = "没有标题的段落。".repeat(2500);
  const chapters = splitNovel(text);
  assert.ok(chapters.length > 1);
  assert.ok(chapters.every((chapter) => chapter.title.startsWith("伪章节")));
});

run("limits story summary to 2000 chars", () => {
  assert.equal(trimToLimit("一".repeat(2200), 2000).length, 2000);
});

run("chapter draft summary only uses the specified chapter", () => {
  const summary = summarizeChapterDraft({ body: "第一句。第二句。第三句。第四句。" });
  assert.ok(summary.includes("第一句"));
  assert.ok(summary.length <= 300);
});

run("story summary draft uses old summary plus recent content and stays within 2000 chars", () => {
  const summary = updateStorySummaryDraft("旧梗概：主角正在追查密信。", "最新一章里，林舟发现玉佩发光。沈月判断玄都内有内应。");
  assert.match(summary, /旧梗概/);
  assert.match(summary, /最近进展/);
  assert.ok(summary.length <= 2000);
});

run("book summary prompt uses chapter summaries without chapter bodies", () => {
  const chapters = splitNovel("第1章 初见\n林舟抵达青石镇，正文不应进入全书摘要提示。\n\n第2章 风起\n沈月发现密信。");
  chapters[0].summary = "林舟抵达青石镇，发现玉佩线索。";
  chapters[1].summary = "沈月发现密信，判断玄都内有内应。";
  const project = createProject("测试书", chapters);
  const chapterSummaries = collectChapterSummaries(project);
  const prompt = buildStorySummaryFromChapterSummariesPrompt(project);

  assert.equal(chapterSummaries.length, 2);
  assert.match(prompt, /根据以下章节摘要/);
  assert.match(prompt, /林舟抵达青石镇/);
  assert.match(prompt, /沈月发现密信/);
  assert.ok(!prompt.includes("正文不应进入全书摘要提示"));
});

run("context includes stable core sources and no full old chapter body", () => {
  const longCurrent = "林舟想起玉佩，继续沿着玄都暗巷追查。".repeat(500);
  const chapters = splitNovel(`第1章 旧事\n林舟在青石镇埋下玉佩伏笔，旧章节原文不应进入上下文。\n\n第2章 追兵\n沈月在青石镇救下林舟。\n\n第3章 入城\n二人抵达玄都。\n\n第4章 当前\n${longCurrent}`);
  chapters[0].summary = "林舟在青石镇藏起玉佩，留下伏笔。";
  chapters[0].summaryStatus = "manual";
  chapters[1].summary = "沈月救下林舟，二人在青石镇结盟。";
  chapters[1].summaryStatus = "manual";
  chapters[2].summary = "林舟和沈月抵达玄都，追查密信。";
  chapters[2].summaryStatus = "manual";
  const project = createProject("测试书", chapters);
  project.storySummary = "林舟和沈月正在追查玉佩背后的势力。";
  project.currentChapterId = chapters[3].id;
  project.knowledgeItems.push({
    id: "k1",
    type: "角色",
    title: "林舟",
    content: "主角，持有玉佩线索。",
    keywords: ["玉佩"],
    isCore: true
  });

  const context = buildContext(project, { userRequest: "续写约1000字" });
  const prompt = buildPrompt(context);

  assert.match(prompt, /续写约1000字/);
  assert.match(prompt, /全书剧情进度梗概/);
  assert.match(prompt, /最近原文/);
  assert.ok(context.recentSummaries.length <= 3);
  assert.equal(context.recalledChapters.length, 0);
  assert.ok(!prompt.includes("旧章节原文不应进入上下文"));
});

run("old chapter recall is disabled by default", () => {
  const chapters = splitNovel("第1章 玉佩\n林舟得到玉佩。\n\n第2章 过渡\n众人离开。\n\n第3章 转场\n众人入城。\n\n第4章 当前\n林舟研究玉佩。");
  chapters[0].summary = "林舟得到玉佩。";
  const project = createProject("测试书", chapters);
  project.currentChapterId = chapters[3].id;
  const context = buildContext(project);
  assert.equal(context.recalledChapters.length, 0);
});

run("accepting generation appends content and records context sources", () => {
  const chapters = splitNovel("第1章 当前\n开头。");
  const project = createProject("测试书", chapters);
  const context = buildContext(project);
  acceptGeneration(project, chapters[0].id, "新增正文。", context);
  assert.match(project.chapters[0].body, /新增正文/);
  assert.equal(project.generationHistory.length, 1);
  assert.ok(project.generationHistory[0].contextSources);
});

run("accepting generation as new chapter inserts after current chapter", () => {
  const chapters = splitNovel("第1章 当前\n开头。\n\n第2章 后续\n结尾。");
  const project = createProject("测试书", chapters);
  const context = buildContext(project, { currentChapterId: chapters[0].id });
  const chapter = acceptGenerationAsNewChapter(project, chapters[0].id, "第2章 新章", "新章正文。", context);
  assert.equal(project.chapters.length, 3);
  assert.equal(project.chapters[1].id, chapter.id);
  assert.equal(project.chapters[1].title, "第2章 新章");
  assert.equal(project.chapters[2].order, 3);
  assert.equal(project.currentChapterId, chapter.id);
  assert.equal(project.generationHistory.at(-1).target, "new_chapter");
});

run("serializes current project back to txt", () => {
  const chapters = splitNovel("第1章 开始\n正文一。\n\n第2章 继续\n正文二。");
  const project = createProject("测试书", chapters);
  assert.equal(serializeProjectToTxt(project), "第1章 开始\n正文一。\n\n第2章 继续\n正文二。\n");
});
