import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { executeRequest } from "../api.js";
import type { WorkbenchRequest } from "../intent.js";
import {
  ContentCopySchema,
  ContentKeywordsSchema,
  GenerateContentSchema,
  ResearchReportSchema,
  type ContentCopy,
  type ContentDetail,
  type ContentRun,
  type ContentVersion,
  type Keyword,
  type ProductDetail,
} from "../../../../src/schemas.js";
import {
  CatalogApiError,
  errorMessage,
} from "../products/api.js";
import { DownloadLink, contentDownloadUrl } from "../shared/DownloadLink.js";
import {
  generateContent,
  getContentDetail,
  listContent,
  listContentRuns,
  randomRequestId,
  reviewContent,
  saveContent,
} from "./api.js";
import { formatTime } from "../products/shared.js";

type ContentPage = ReturnType<typeof listContent> extends Promise<infer T> ? T : never;
type RunPage = ReturnType<typeof listContentRuns> extends Promise<infer T> ? T : never;

function headVersionNumber(page: ContentPage) {
  if (!page.headVersionId) return undefined;
  return page.items.find(item => item.id === page.headVersionId)?.versionNumber;
}

const parseLines = (value: string) => [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];

function keywordsForText(value: string) {
  const result = ContentKeywordsSchema.safeParse(parseLines(value));
  return result.success ? result.data : undefined;
}

function copyErrors(copy: ContentCopy) {
  const parsed = ContentCopySchema.safeParse(copy);
  return parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join(".") || "文案"}：${issue.message}`);
}

function requestForResearch(keyword: string): WorkbenchRequest {
  return { kind: "research", payload: { keyword, marketplace: "us", deep: false, compareWith: [] }, exampleData: [] };
}

function statusLabel(status: ContentRun["status"]) {
  return { running: "进行中", succeeded: "已完成", failed: "失败", interrupted: "已中断" }[status];
}

function sourceLabel(source: ContentVersion["source"]) {
  return { template: "本地模板", model: "文字模型", manual: "人工编辑" }[source];
}

function CopyEditor({ copy, disabled, onChange }: { copy: ContentCopy; disabled: boolean; onChange: (copy: ContentCopy) => void }) {
  const set = <K extends keyof ContentCopy>(key: K, value: ContentCopy[K]) => onChange({ ...copy, [key]: value });
  return <div className="content-copy-editor">
    <label>标题 <span className="content-counter">{copy.title.length}/75</span><input aria-label="英文标题" maxLength={75} disabled={disabled} value={copy.title} onChange={event => set("title", event.target.value)} /></label>
    <label>Item highlights <span className="content-counter">{copy.itemHighlights.length}/125</span><textarea aria-label="Item highlights" maxLength={125} rows={2} disabled={disabled} value={copy.itemHighlights} onChange={event => set("itemHighlights", event.target.value)} /></label>
    <fieldset disabled={disabled}><legend>五条 Bullet</legend>{copy.bullets.map((bullet, index) => <label key={index}>Bullet {index + 1} <span className="content-counter">{bullet.length}/500</span><textarea aria-label={`Bullet ${index + 1}`} maxLength={500} rows={3} value={bullet} onChange={event => set("bullets", copy.bullets.map((old, i) => i === index ? event.target.value : old))} /></label>)}</fieldset>
    <label>Description <span className="content-counter">{copy.description.length}/2000</span><textarea aria-label="Description" maxLength={2000} rows={7} disabled={disabled} value={copy.description} onChange={event => set("description", event.target.value)} /></label>
    <label>Backend search terms <span className="content-counter">{new TextEncoder().encode(copy.backendSearchTerms.join(" ")).byteLength}/249 UTF-8 bytes</span><textarea aria-label="Backend search terms" rows={3} disabled={disabled} value={copy.backendSearchTerms.join("\n")} onChange={event => set("backendSearchTerms", event.target.value ? event.target.value.split(/\r?\n/) : [])} placeholder="每行一个词" /></label>
  </div>;
}

export function ContentStudio({ product, knowledgeRevisionIds, onDirty, disabled = false }: {
  product: ProductDetail;
  knowledgeRevisionIds?: string[];
  onDirty?: (dirty: boolean) => void;
  disabled?: boolean;
}) {
  const [page, setPage] = useState<ContentPage>();
  const [runs, setRuns] = useState<RunPage>();
  const [detail, setDetail] = useState<ContentDetail>();
  const [keywords, setKeywords] = useState("");
  const [candidates, setCandidates] = useState<Keyword[]>([]);
  const [mode, setMode] = useState<"template" | "model">("template");
  const [draft, setDraft] = useState<ContentCopy>();
  const [baseline, setBaseline] = useState("");
  const [draftBaseId, setDraftBaseId] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"loading" | "researching" | "generating" | "saving" | "reviewing" | "reconciling" | undefined>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewBaseline, setReviewBaseline] = useState("");
  const [latestVersionNumber, setLatestVersionNumber] = useState<number>();
  const [revisionOffset, setRevisionOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const loadController = useRef<AbortController | undefined>(undefined);
  const requestedOffsets = useRef({ revisions: 0, runs: 0 });
  const loadedProductId = useRef("");
  const alive = useRef(true);

  const copyDirty = Boolean(editing && draft && JSON.stringify(draft) !== baseline);
  const reviewDirty = reviewNotes !== reviewBaseline;
  const dirty = copyDirty || reviewDirty;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onDirty?.(false); }; }, [onDirty]);

  const showDetail = useCallback(async (versionId: string, signal?: AbortSignal) => {
    const token = ++detailSequence.current;
    const selected = await getContentDetail(product.product.id, versionId, signal);
    if (!alive.current || signal?.aborted || token !== detailSequence.current) return;
    setDetail(selected);
    setReviewNotes(selected.review?.notes ?? "");
    setReviewBaseline(selected.review?.notes ?? "");
  }, [product.product.id]);

  const load = useCallback(async (offset = 0, nextRunOffset = 0, resetDetail = false) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const token = ++sequence.current;
    requestedOffsets.current = { revisions: offset, runs: nextRunOffset };
    setBusy("loading"); setError("");
    const [contentResult, runResult] = await Promise.allSettled([
      listContent(product.product.id, offset, 20, controller.signal),
      listContentRuns(product.product.id, nextRunOffset, 20, controller.signal),
    ]);
    if (!alive.current || controller.signal.aborted || token !== sequence.current) return;
    if (contentResult.status === "fulfilled") {
      const nextPage = contentResult.value;
      setPage(nextPage); setRevisionOffset(nextPage.offset);
      const nextHeadVersionNumber = headVersionNumber(nextPage);
      if (!nextPage.headVersionId) setLatestVersionNumber(undefined);
      else if (nextHeadVersionNumber !== undefined) setLatestVersionNumber(nextHeadVersionNumber);
      const target = nextPage.headVersionId ?? nextPage.items[0]?.id;
      if (resetDetail && target) {
        setDraft(undefined); setEditing(false); setBaseline(""); setDraftBaseId("");
        try { await showDetail(target, controller.signal); }
        catch (loadError) { if (!controller.signal.aborted) setError(errorMessage(loadError)); }
      } else if (resetDetail && !target) {
        setDetail(undefined); setDraft(undefined); setEditing(false); setBaseline("");
      } else if (dirtyRef.current) {
        setNotice("已刷新服务端记录，本地文案、审核备注与原保存基准保留。请提交或放弃编辑后查看其他版本。");
      }
    } else if (contentResult.reason instanceof Error && contentResult.reason.name !== "AbortError") {
      setError(errorMessage(contentResult.reason));
    }
    if (runResult.status === "fulfilled") { setRuns(runResult.value); setRunOffset(runResult.value.offset); }
    else if (runResult.reason instanceof Error && runResult.reason.name !== "AbortError") setError(errorMessage(runResult.reason));
    loadedProductId.current = product.product.id;
    if (alive.current) setBusy(undefined);
  }, [product.product.id, showDetail]);

  useEffect(() => {
    const productChanged = loadedProductId.current !== product.product.id;
    if (productChanged) {
      detailSequence.current += 1;
      setPage(undefined); setRuns(undefined); setDetail(undefined); setDraft(undefined); setBaseline(""); setDraftBaseId("");
      setLatestVersionNumber(undefined);
      setRevisionOffset(0); setRunOffset(0); setReviewNotes(""); setReviewBaseline("");
      setKeywords(""); setCandidates([]); setPendingRequestId(""); setConflict(false);
    }
    void load(productChanged ? 0 : revisionOffset, productChanged ? 0 : runOffset, productChanged);
    return () => { sequence.current += 1; loadController.current?.abort(); };
  }, [load, product.product.id, product.currentRevision.id]);

  function beginEdit() {
    if (disabled || editing || !detail || page?.headVersionId !== detail.content.id) return;
    setDraft(structuredClone(detail.content.copy));
    setBaseline(JSON.stringify(detail.content.copy));
    setDraftBaseId(detail.content.id);
    setEditing(true); setError(""); setNotice("");
  }

  function cancelEdit() {
    if (copyDirty && !window.confirm("放弃尚未保存的文案编辑？")) return;
    setDraft(undefined); setBaseline(""); setEditing(false);
  }

  async function research() {
    if (busy || disabled) return;
    const primary = parseLines(keywords)[0];
    if (!primary) { setError("先输入一个研究关键词，每行一个词。没有默认示例关键词。"); return; }
    setBusy("researching"); setError(""); setNotice("");
    try {
      const result = await executeRequest(requestForResearch(primary));
      if (!alive.current) return;
      const parsed = ResearchReportSchema.safeParse(result);
      if (!parsed.success) throw new Error("研究结果未通过契约校验。");
      setCandidates(parsed.data.keywords);
      setNotice(`已读取 ${parsed.data.keywords.length} 个研究候选，请逐项勾选。`);
    } catch (researchError) { if (alive.current) setError(errorMessage(researchError)); }
    finally { if (alive.current) setBusy(undefined); }
  }

  function toggleCandidate(phrase: string, checked: boolean) {
    const values = parseLines(keywords);
    const next = checked ? [...values, phrase] : values.filter(value => value.toLowerCase() !== phrase.toLowerCase());
    setKeywords(next.join("\n"));
  }

  function moveKeyword(index: number, direction: -1 | 1) {
    const values = parseLines(keywords);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= values.length) return;
    [values[index], values[target]] = [values[target]!, values[index]!];
    setKeywords(values.join("\n"));
  }

  async function generate() {
    if (busy || disabled) return;
    if (dirty && !window.confirm("重新生成将替换未提交的文案或审核备注，继续？")) return;
    const parsedKeywords = keywordsForText(keywords);
    if (!parsedKeywords?.length) { setError("至少选择或输入一个关键词。"); return; }
    const input = GenerateContentSchema.safeParse({
      requestId: randomRequestId(), sourceRevisionId: product.currentRevision.id,
      baseContentVersionId: page?.headVersionId ?? null, marketplace: "us",
      keywords: parsedKeywords, mode, knowledgeRevisionIds: knowledgeRevisionIds ?? [],
    });
    if (!input.success) { setError(input.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；")); return; }
    setBusy("generating"); setError(""); setNotice(""); setConflict(false); setPendingRequestId(input.data.requestId);
    try {
      const result = await generateContent(product.product.id, input.data);
      if (!alive.current) return;
      if (result.run.status !== "succeeded" || !result.content) {
        setError(result.run.errorMessage ?? "生成任务未成功完成。");
        setNotice("本次请求 ID 已保留。请使用“核对生成记录”查看结果，不要自动新建请求。");
        return;
      }
      const nextDetail = await getContentDetail(product.product.id, result.content.id);
      if (!alive.current) return;
      setRevisionOffset(0);
      setLatestVersionNumber(result.content.versionNumber);
      setPage(current => current ? { ...current, offset: 0, headVersionId: result.content!.id, total: current.total + (current.items.some(item => item.id === result.content!.id) ? 0 : 1), items: [result.content!, ...current.items.filter(item => item.id !== result.content!.id)].slice(0, current.limit) } : current);
      setDetail(nextDetail); setDraft(structuredClone(result.content.copy)); setBaseline(JSON.stringify(result.content.copy)); setEditing(true);
      setReviewNotes(nextDetail.review?.notes ?? ""); setReviewBaseline(nextDetail.review?.notes ?? "");
      setDraftBaseId(result.content.id);
      setNotice(result.reused ? "已读取同一请求 ID 的既有生成结果。" : "文案已生成，请逐项核对事实后保存或审核。");
      setRuns(current => current && current.offset === 0 ? { ...current, total: current.total + (current.items.some(item => item.id === result.run.id) ? 0 : 1), items: [result.run, ...current.items.filter(item => item.id !== result.run.id)].slice(0, current.limit) } : current);
    } catch (generateError) {
      if (alive.current) {
        setError(errorMessage(generateError));
        if (generateError instanceof CatalogApiError && generateError.status === 409) { setConflict(true); setNotice("当前资料或最新文案版本 已变化；草稿仍保留，可重载最新版本 后决定如何处理。"); }
      }
    } finally { if (alive.current) setBusy(undefined); }
  }

  async function reconcile() {
    if (!pendingRequestId || busy) return;
    setBusy("reconciling"); setError("");
    try {
      const result = await listContentRuns(product.product.id, runs?.offset ?? runOffset, runs?.limit ?? 20);
      if (!alive.current) return;
      const run = result.items.find(item => item.requestId === pendingRequestId);
      if (!run) { setNotice("服务器暂未找到这次请求记录；请稍后再次核对，不会自动创建新请求。"); return; }
      setRuns(result); setRunOffset(result.offset);
      if (run.status === "succeeded" && run.contentVersionId) {
        if (!dirtyRef.current) { setDraft(undefined); setEditing(false); await showDetail(run.contentVersionId); }
        setNotice("已找到本次请求生成的版本。");
      } else setNotice(run.errorMessage ?? `请求状态：${statusLabel(run.status)}。`);
    } catch (reconcileError) { if (alive.current) setError(errorMessage(reconcileError)); }
    finally { if (alive.current) setBusy(undefined); }
  }

  async function save() {
    if (!draft || !detail || busy || disabled) return;
    const parsed = ContentCopySchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；")); return; }
    const base = draftBaseId;
    if (!base) { setError("当前还没有可保存的文案版本，请先生成模板文案。"); return; }
    setBusy("saving"); setError(""); setNotice(""); setConflict(false);
    try {
      const version = await saveContent(product.product.id, { baseContentVersionId: base, copy: parsed.data });
      if (!alive.current) return;
      const nextDetail = await getContentDetail(product.product.id, version.id);
      if (!alive.current) return;
      setDetail(nextDetail); setRevisionOffset(0); setLatestVersionNumber(version.versionNumber); setPage(current => current ? { ...current, offset: 0, headVersionId: version.id, total: current.total + (current.items.some(item => item.id === version.id) ? 0 : 1), items: [version, ...current.items.filter(item => item.id !== version.id)].slice(0, current.limit) } : current);
      setDraft(structuredClone(version.copy)); setBaseline(JSON.stringify(version.copy)); setEditing(true);
      setReviewNotes(""); setReviewBaseline("");
      setDraftBaseId(version.id);
      setNotice("人工编辑已保存为新的文案版本。");
    } catch (saveError) {
      if (alive.current) {
        setError(errorMessage(saveError));
        if (saveError instanceof CatalogApiError && saveError.status === 409) { setConflict(true); setNotice("最新文案版本 已被其他操作更新，本地草稿已保留。请重载最新版本 或继续编辑后再决定。"); }
      }
    } finally { if (alive.current) setBusy(undefined); }
  }

  async function reloadHead() {
    if (busy) return;
    if (dirty && !window.confirm("重载会放弃未提交的文案或审核备注，确定继续？")) return;
    setBusy("loading"); setError("");
    try {
      const fresh = await listContent(product.product.id, 0, page?.limit ?? 20);
      if (!alive.current) return;
      requestedOffsets.current.revisions = 0; setPage(fresh); setRevisionOffset(fresh.offset);
      const freshHeadVersionNumber = headVersionNumber(fresh);
      if (!fresh.headVersionId) setLatestVersionNumber(undefined);
      else if (freshHeadVersionNumber !== undefined) setLatestVersionNumber(freshHeadVersionNumber);
      if (fresh.headVersionId) await showDetail(fresh.headVersionId);
      setDraft(undefined); setBaseline(""); setEditing(false); onDirty?.(false); setNotice("已重载当前最新文案版本。");
      setConflict(false);
    } catch (reloadError) { if (alive.current) setError(errorMessage(reloadError)); }
    finally { if (alive.current) setBusy(undefined); }
  }

  async function submitReview(decision: "approved" | "rejected") {
    if (!detail || busy || disabled || copyDirty || (decision === "approved" && detail.stale)) return;
    setBusy("reviewing"); setError("");
    try {
      const review = await reviewContent(product.product.id, detail.content.id, { decision, notes: reviewNotes.trim() });
      if (!alive.current) return;
      setDetail(current => current ? { ...current, review } : current);
      setReviewNotes(review.notes); setReviewBaseline(review.notes);
      setNotice(decision === "approved" ? "已记录人工批准；正式导出按钮已更新。" : "已记录退回意见，请编辑或重新生成。");
    } catch (reviewError) { if (alive.current) setError(errorMessage(reviewError)); }
    finally { if (alive.current) setBusy(undefined); }
  }

  async function selectVersion(versionId: string) {
    if (busy || (dirty && !window.confirm("查看其他版本会放弃未提交的文案或审核备注，继续？"))) return;
    setBusy("loading");
    try {
      await showDetail(versionId);
      if (!alive.current) return;
      setEditing(false); setDraft(undefined); setBaseline(""); setDraftBaseId("");
    } catch (readError) { if (alive.current) setError(errorMessage(readError)); }
    finally { if (alive.current) setBusy(undefined); }
  }

  const keywordList = useMemo(() => parseLines(keywords), [keywords]);
  const isHead = Boolean(detail && page?.headVersionId === detail.content.id);
  const currentCopy = draft ?? detail?.content.copy;
  const issueList = draft ? copyErrors(draft) : [];
  const approved = detail?.review?.decision === "approved";
  const officialDisabled = !detail || detail.stale || !approved || Boolean(busy) || disabled || dirty;

  return <section className="products-card content-studio" aria-labelledby="content-studio-heading">
    <div className="products-section-heading"><div><p className="products-eyebrow">US · en_US · SKU {product.product.sku} · 当前资料版本 {product.currentRevision.revisionNumber}</p><h2 id="content-studio-heading">商品文案工作室</h2><p>文案版本绑定当前商品资料；生成结果必须人工核对后审核。</p></div>
      <span className="content-head-badge">{page?.headVersionId ? `最新版本 v${latestVersionNumber ?? "?"}` : "尚无文案"}</span></div>
    {error ? <div className="products-error" role="alert">{error}<button type="button" onClick={() => void load(requestedOffsets.current.revisions, requestedOffsets.current.runs)}>重试读取文案</button>{conflict ? <button type="button" onClick={() => void reloadHead()}>重载最新版本</button> : null}</div> : null}
    <div className="content-generation-panel">
      <label>关键词（每行一个）<textarea aria-label="文案关键词" rows={4} disabled={Boolean(busy) || disabled} value={keywords} onChange={event => setKeywords(event.target.value)} placeholder="输入真实关键词；第一行会作为主词" /></label>
      <div className="content-keyword-toolbar"><span>{keywordList.length ? `主词：${keywordList[0]} · 已选 ${keywordList.length}/50` : "尚未选择关键词"}</span><button type="button" disabled={Boolean(busy) || disabled} onClick={() => void research()}>从关键词研究获取候选</button></div>
      {candidates.length ? <fieldset className="content-candidates" disabled={Boolean(busy) || disabled}><legend>研究候选（仅勾选加入，不自动写入）</legend>{candidates.map(candidate => <label key={candidate.phrase}><input type="checkbox" checked={keywordList.some(value => value.toLowerCase() === candidate.phrase.toLowerCase())} onChange={event => toggleCandidate(candidate.phrase, event.target.checked)} />{candidate.phrase}<small>{candidate.source}</small></label>)}</fieldset> : null}
      {keywordList.length ? <ol className="content-keyword-list" aria-label="已选关键词">{keywordList.map((keyword, index) => <li key={`${keyword}-${index}`}><span>{keyword}{index === 0 ? " · 主词" : ""}</span><button type="button" aria-label={`关键词${keyword}上移`} disabled={disabled || Boolean(busy) || index === 0} onClick={() => moveKeyword(index, -1)}>↑</button><button type="button" aria-label={`关键词${keyword}下移`} disabled={disabled || Boolean(busy) || index === keywordList.length - 1} onClick={() => moveKeyword(index, 1)}>↓</button><button type="button" aria-label={`删除关键词${keyword}`} disabled={disabled || Boolean(busy)} onClick={() => toggleCandidate(keyword, false)}>移除</button></li>)}</ol> : null}
      <div className="content-generation-actions"><label>生成方式<select aria-label="生成方式" disabled={Boolean(busy) || disabled} value={mode} onChange={event => setMode(event.target.value as "template" | "model")}><option value="template">本地模板（默认）</option><option value="model">AI 模式（需服务端配置）</option></select></label><button type="button" className="products-primary" disabled={Boolean(busy) || disabled} onClick={() => void generate()}>{busy === "generating" ? "正在生成…" : "生成文案"}</button></div>
      {knowledgeRevisionIds?.length ? <p className="content-note">已选择 {knowledgeRevisionIds.length} 条已确认知识版本，将保存为审核依据。模板按商品字段排版；配置后的文字模型可结合所选知识撰写。</p> : <p className="content-note">未选择知识版本；生成只会使用商品资料和关键词。</p>}
    </div>
    {pendingRequestId && (error || busy === "reconciling") ? <div className="content-uncertain"><span>本次请求 ID：<code>{pendingRequestId}</code></span><button type="button" disabled={Boolean(busy)} onClick={() => void reconcile()}>{busy === "reconciling" ? "正在核对…" : "核对生成记录"}</button></div> : null}
    {notice ? <p className="content-notice" role="status">{notice}</p> : null}
    {page ? <div className="content-history"><div className="products-section-heading"><h3>文案版本历史</h3><span>选择历史版本只查看快照，不改变最新版本。</span></div>{page.items.length ? <div className="products-version-list">{page.items.map(version => <button type="button" key={version.id} disabled={Boolean(busy)} aria-pressed={detail?.content.id === version.id} onClick={() => void selectVersion(version.id)}><strong>v{version.versionNumber}{version.id === page.headVersionId ? " · 最新版本" : " · 历史"}</strong><small>{sourceLabel(version.source)} · {formatTime(version.createdAt)}</small></button>)}</div> : <p>当前页没有文案版本。</p>}{page.total > page.limit ? <div className="products-pagination"><button disabled={Boolean(busy) || page.offset === 0} onClick={() => void load(Math.max(0, page.offset - page.limit), runOffset)}>上一页文案</button><span>共 {page.total} 个版本</span><button disabled={Boolean(busy) || page.offset + page.limit >= page.total} onClick={() => void load(page.offset + page.limit, runOffset)}>下一页文案</button></div> : null}</div> : null}
    {detail ? <>
      <div className="content-version-strip"><div><strong>文案 v{detail.content.versionNumber}</strong><span> · {sourceLabel(detail.content.source)} · 创建于 {formatTime(detail.content.createdAt)}</span>{isHead ? <b> · 最新版本</b> : <em> · 历史只读</em>}</div><div className="products-actions"><button type="button" disabled={disabled || !isHead || Boolean(busy)} onClick={beginEdit}>{editing ? "正在编辑" : "编辑当前版本"}</button>{editing ? <><button type="button" disabled={Boolean(busy)} onClick={cancelEdit}>取消编辑</button><button type="button" className="products-primary" disabled={Boolean(busy) || disabled || !copyDirty} onClick={() => void save()}>{busy === "saving" ? "正在保存…" : "保存新版本"}</button></> : null}</div></div>
      {detail.stale ? <div className="products-conflict"><strong>依据已过期，不能批准或正式导出。</strong><p>{detail.staleReasons.join("、")}</p><button type="button" disabled={Boolean(busy) || disabled} onClick={() => void generate()}>用当前资料重新生成</button></div> : null}
      {currentCopy ? <CopyEditor copy={currentCopy} disabled={!editing || disabled || Boolean(busy)} onChange={setDraft} /> : null}
      {issueList.length ? <div className="products-error" role="alert"><strong>保存前请修正文案限制：</strong><ul>{issueList.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : null}
      <div className="content-review-panel">
        <div><strong>审核状态：</strong>{detail.review ? detail.review.decision === "approved" ? "已批准" : "已退回" : "待人工确认"}</div>
        {copyDirty ? <p>请先保存或取消文案编辑，再审核和导出当前保存版本。</p> : reviewDirty ? <p>审核备注尚未提交，请选择批准或退回以保存审核记录。</p> : null}
        <label>审核备注<textarea aria-label="审核备注" rows={3} maxLength={10000} disabled={Boolean(busy) || disabled || copyDirty} value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} placeholder="记录事实核对、退回原因或审核范围" /></label>
        <div className="products-actions">
          <button type="button" disabled={Boolean(busy) || disabled || copyDirty || detail.stale || !isHead} onClick={() => void submitReview("approved")}>人工批准</button>
          <button type="button" disabled={Boolean(busy) || disabled || copyDirty || !isHead} onClick={() => void submitReview("rejected")}>退回修改</button>
          <DownloadLink href={contentDownloadUrl(product.product.id, detail.content.id, true)} disabled={Boolean(busy) || dirty}>下载草稿 JSON</DownloadLink>
          <DownloadLink href={contentDownloadUrl(product.product.id, detail.content.id, false)} disabled={officialDisabled}>下载正式 JSON</DownloadLink>
        </div>
      </div>
      <div className="content-evidence"><p><strong>生成时的资料版本：</strong><code>{detail.content.sourceRevisionId}</code> · 规则版本 {detail.content.rulesVersion}</p><p><strong>覆盖率：</strong>{detail.content.coverage.coveragePct}% · 未覆盖 {detail.content.coverage.uncovered.length ? detail.content.coverage.uncovered.join("、") : "无"}</p><details><summary>查看来源与依据（{detail.content.evidence.length} 条）</summary>{detail.content.evidence.length ? <ul>{detail.content.evidence.map(item => <li key={`${item.entryId}-${item.revisionId}`}><strong>{item.title}</strong> · {item.source}<p>{item.content}</p></li>)}</ul> : <p>当前版本没有附加知识依据。</p>}</details></div>
    </> : <p className="products-empty">还没有文案版本。输入真实关键词后选择模板或 AI 模式生成。</p>}
    <div className="content-runs"><div className="products-section-heading"><h3>最近生成记录</h3><button type="button" disabled={Boolean(busy)} onClick={() => void load(revisionOffset, runOffset)}>刷新记录</button></div>{runs?.items.length ? <ul>{runs.items.map(run => <li key={run.id}><span><strong>{statusLabel(run.status)}</strong> · {run.mode === "template" ? "模板" : "AI"} · {formatTime(run.startedAt)}</span>{run.status === "failed" || run.status === "interrupted" ? <span className="content-run-error">{run.errorMessage ?? run.errorCode}</span> : run.contentVersionId ? <button type="button" disabled={Boolean(busy)} onClick={() => void selectVersion(run.contentVersionId!)}>查看版本</button> : null}</li>)}</ul> : <p>尚无生成记录。</p>}{runs && runs.total > runs.limit ? <div className="products-pagination"><button disabled={Boolean(busy) || runs.offset === 0} onClick={() => void load(revisionOffset, Math.max(0, runs.offset - runs.limit))}>上一页生成记录</button><span>共 {runs.total} 条记录</span><button disabled={Boolean(busy) || runs.offset + runs.limit >= runs.total} onClick={() => void load(revisionOffset, runs.offset + runs.limit)}>下一页生成记录</button></div> : null}</div>
  </section>;
}
