import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentBatch, CreateContentBatch, GenerateContent, ProductDetail, ProductSummary } from "../../../../src/schemas.js";
import { CreateContentBatchSchema, GenerateContentSchema, ProductImportSchema } from "../../../../src/schemas.js";
import { errorMessage, getProduct, listProducts } from "../products/api.js";
import { listContent } from "../content/api.js";
import { createBatch, executeBatch, getBatch, importProducts, listBatches, randomRequestId } from "./api.js";

type DraftItem = { productId: string; input?: GenerateContent; detail?: ProductDetail; loading?: boolean };
type BatchPage = ReturnType<typeof listBatches> extends Promise<infer T> ? T : never;

function lines(value: string) { return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))].slice(0, 50); }
function wait(ms: number) { return new Promise<void>(resolve => window.setTimeout(resolve, ms)); }
async function readFile(file: File) {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? "")); reader.onerror = () => reject(reader.error ?? new Error("无法读取文件。")); reader.readAsText(file); });
}

function batchStatus(status: ContentBatch["status"]) {
  return { queued: "待执行", running: "执行中", succeeded: "已完成", partial: "部分完成", failed: "失败", interrupted: "已中断" }[status];
}
type PendingBatch = { input: CreateContentBatch; draftKey: string; attempted?: boolean; created?: ContentBatch };

// Request IDs identify a concrete create attempt. They are intentionally
// omitted from the draft identity so editing a keyword does not consume a new
// item key before the user actually creates a batch.
function batchInputKey(input: Pick<CreateContentBatch, "items">) {
  return JSON.stringify(input.items.map(item => ({
    productId: item.productId,
    input: { ...item.input, requestId: "" },
  })));
}

export function BatchStudio({ onDirty }: { onDirty?: (dirty: boolean) => void }) {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [batches, setBatches] = useState<ContentBatch[]>([]);
  const [batchPage, setBatchPage] = useState<BatchPage>();
  const [batchOffset, setBatchOffset] = useState(0);
  const [current, setCurrent] = useState<ContentBatch>();
  const [commonKeywords, setCommonKeywords] = useState("");
  const [advancedJson, setAdvancedJson] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{ index: number; sku: string; productId: string | null; status: "created" | "failed"; errorMessage: string | null }[]>();
  const request = useRef<AbortController | undefined>(undefined);
  const detailRequest = useRef<AbortController | undefined>(undefined);
  const detailSequence = useRef(0);
  const historyRequest = useRef<AbortController | undefined>(undefined);
  const historySequence = useRef(0);
  const requestedHistoryOffset = useRef(0);
  const loadSequence = useRef(0);
  const alive = useRef(true);
  const savedSnapshot = useRef("");
  const userEdited = useRef(false);
  const pendingBatch = useRef<PendingBatch | undefined>(undefined);
  const prepareSequence = useRef(new Map<string, number>());
  const draftKey = useMemo(() => JSON.stringify({ drafts: drafts.map(item => ({ productId: item.productId, input: item.input ? { ...item.input, requestId: "" } : null })), advancedJson, commonKeywords }), [advancedJson, commonKeywords, drafts]);
  const dirty = userEdited.current && draftKey !== savedSnapshot.current && Boolean(drafts.length || advancedJson || commonKeywords);

  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); historyRequest.current?.abort(); detailRequest.current?.abort(); onDirty?.(false); }; }, [onDirty]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const token = ++loadSequence.current;
    setLoading(true); setError("");
    const result = await Promise.allSettled([listProducts("", 0, controller.signal), listBatches(0, 30, controller.signal)]);
    if (!alive.current || controller.signal.aborted || token !== loadSequence.current) return;
    const [productResult, batchResult] = result;
    const rejected = result.find(item => item.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected && !(rejected.reason instanceof DOMException && rejected.reason.name === "AbortError")) setError(errorMessage(rejected.reason));
    if (productResult?.status === "fulfilled") setProducts(productResult.value.items);
    if (batchResult?.status === "fulfilled") { setBatchPage(batchResult.value); setBatchOffset(batchResult.value.offset); setBatches(batchResult.value.items); }
    setLoading(false);
  }, []);
  useEffect(() => { void load().catch(cause => { if (alive.current) setError(errorMessage(cause)); }); return () => request.current?.abort(); }, [load]);

  const loadHistory = useCallback(async (offset: number) => {
    historyRequest.current?.abort();
    const controller = new AbortController(); historyRequest.current = controller;
    const token = ++historySequence.current;
    requestedHistoryOffset.current = offset;
    setLoading(true); setError("");
    try {
      const page = await listBatches(offset, 30, controller.signal);
      if (!alive.current || controller.signal.aborted || token !== historySequence.current) return page;
      setBatchPage(page); setBatchOffset(page.offset); setBatches(page.items);
      return page;
    } finally {
      if (alive.current && token === historySequence.current) setLoading(false);
    }
  }, []);

  const selectedIds = useMemo(() => new Set(drafts.map(item => item.productId)), [drafts]);
  async function prepareItem(productId: string) {
    const token = (prepareSequence.current.get(productId) ?? 0) + 1;
    prepareSequence.current.set(productId, token);
    try {
      const [detail, content] = await Promise.all([getProduct(productId), listContent(productId, 0, 30)]);
      if (!alive.current || prepareSequence.current.get(productId) !== token) return;
      const input = GenerateContentSchema.parse({ requestId: randomRequestId(), sourceRevisionId: detail.currentRevision.id, baseContentVersionId: content.headVersionId, marketplace: "us", keywords: [], mode: "template", knowledgeRevisionIds: [] });
      setDrafts(old => old.map(item => item.productId === productId ? { ...item, detail, input, loading: false } : item));
    } catch (cause) {
      if (alive.current && prepareSequence.current.get(productId) === token) {
        setError(errorMessage(cause));
        setDrafts(old => old.map(item => item.productId === productId ? { ...item, loading: false } : item));
      }
    }
  }
  function toggleProduct(productId: string) {
    userEdited.current = true;
    setError("");
    if (selectedIds.has(productId)) {
      prepareSequence.current.set(productId, (prepareSequence.current.get(productId) ?? 0) + 1);
      setDrafts(old => old.filter(item => item.productId !== productId));
      return;
    }
    if (drafts.length >= 20) { setError("每批最多选择 20 个已保存商品。"); return; }
    setDrafts(old => [...old, { productId, loading: true }]); void prepareItem(productId).catch(cause => { if (alive.current) setError(errorMessage(cause)); });
  }
  function updateKeywords(productId: string, value: string) {
    userEdited.current = true;
    setDrafts(old => old.map(item => item.productId === productId && item.input ? { ...item, input: { ...item.input, keywords: lines(value) } } : item));
  }
  function applyCommonKeywords() {
    userEdited.current = true;
    const values = lines(commonKeywords);
    setDrafts(old => old.map(item => item.input ? { ...item, input: { ...item.input, keywords: values } } : item));
  }
  function applyJson() {
    const parsed = CreateContentBatchSchema.safeParse(JSON.parse(advancedJson));
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；")); return; }
    const value = parsed.data;
    userEdited.current = true;
    setDrafts(value.items.map(item => ({ productId: item.productId, input: item.input })));
    setNotice("已载入批次 JSON；提交前请确认每个资料版本和基准文案版本。"); setError("");
  }
  async function create() {
    if (busy) return;
    const items = drafts.flatMap(item => item.input ? [{ productId: item.productId, input: item.input }] : []);
    if (items.length !== drafts.length) { setError("请等待所有商品资料读取完成后再创建批次。"); return; }
    const currentDraftKey = batchInputKey({ items });
    const previous = pendingBatch.current;
    const sameInput = previous?.draftKey === currentDraftKey;
    const candidate = sameInput
      ? previous.input
      : { requestId: randomRequestId(), items: items.map(item => ({ ...item, input: { ...item.input, requestId: randomRequestId() } })) };
    const input = CreateContentBatchSchema.safeParse(candidate);
    if (!input.success) { setError(input.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；")); return; }
    pendingBatch.current = sameInput && previous ? previous : { input: input.data, draftKey: currentDraftKey };
    setBusy(true); setError(""); setNotice("");
    try {
      if (pendingBatch.current.created) {
        if (alive.current) { setCurrent(pendingBatch.current.created); setNotice("该输入已创建批次，保留原任务键；需要时可明确执行。"); }
        return;
      }
      pendingBatch.current.attempted = true;
      const result = await createBatch(input.data); if (!alive.current) return;
      pendingBatch.current = { input: input.data, draftKey: currentDraftKey, attempted: true, created: result }; setCurrent(result); savedSnapshot.current = draftKey; setNotice("批次已创建；需要点击“明确执行”才会开始任务。");
      try { await loadHistory(0); }
      catch (cause) { if (alive.current) setNotice(`批次已创建，但历史列表刷新失败：${errorMessage(cause)}`); }
    }
    catch (cause) { if (alive.current) { setError(errorMessage(cause)); setNotice(`批次结果待确认；保留批次 requestId ${input.data.requestId} 及全部商品任务键，可核对后再重试。`); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function reconcilePending() {
    const pending = pendingBatch.current;
    if (!pending || pending.created || busy) return;
    setBusy(true); setError("");
    try {
      const page = await loadHistory(batchOffset);
      const found = page?.items.find(item => item.requestId === pending.input.requestId);
      if (found) { pending.created = found; setCurrent(found); setNotice("已核对到当前页的原批次记录，保留全部原任务键。"); return; }
      if (alive.current) setNotice("当前页暂未找到原批次记录；可翻页继续核对，保留原 requestId，不会自动创建新批次。");
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function execute() {
    if (!current || busy || current.status !== "queued") return;
    setBusy(true); setError(""); setNotice(`正在明确执行批次 ${current.id.slice(0, 8)}…`);
    try {
      let executionResult: ContentBatch | undefined;
      let executionError: unknown;
      const execution = executeBatch(current.id).then(result => { executionResult = result; return result; }).catch(cause => { executionError = cause; throw cause; });
      let seen = current;
      for (let attempt = 0; attempt < 120 && alive.current; attempt += 1) {
        if (executionError) throw executionError;
        if (executionResult && executionResult.status !== "queued" && executionResult.status !== "running") break;
        const next = await getBatch(current.id); if (!alive.current) return; seen = next; setCurrent(next);
        if (next.status !== "queued" && next.status !== "running") break;
        await wait(700);
      }
      // Keep the execute request explicit and await its durable response too.
      const result = await execution; if (!alive.current) return; seen = result; setCurrent(result);
      setNotice(`批次执行完成：${batchStatus(seen.status)}。`);
      await loadHistory(0);
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function viewBatch(id: string) {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    const token = ++detailSequence.current;
    try { const value = await getBatch(id, controller.signal); if (alive.current && !controller.signal.aborted && token === detailSequence.current) setCurrent(value); }
    catch (cause) { if (alive.current && !controller.signal.aborted && token === detailSequence.current) setError(errorMessage(cause)); }
  }
  async function retryFailed() {
    if (!current || busy) return;
    const failed = current.items.filter(item => item.status === "failed" || item.status === "interrupted");
    if (!failed.length) { setError("当前批次没有失败或中断项可重试。"); return; }
    setBusy(true); setError("");
    try {
      const items = await Promise.all(failed.map(async item => {
        const [detail, content] = await Promise.all([getProduct(item.productId), listContent(item.productId, 0, 30)]);
        const next = GenerateContentSchema.parse({ ...item.input, requestId: randomRequestId(), sourceRevisionId: detail.currentRevision.id, baseContentVersionId: content.headVersionId });
        return { productId: item.productId, input: next };
      }));
      const result = await createBatch({ requestId: randomRequestId(), items }); if (!alive.current) return; setCurrent(result); setNotice("已为失败项创建新批次；成功项未重试，也未自动执行。"); await loadHistory(0);
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setImportBusy(true); setError(""); setNotice("");
    try { const raw = JSON.parse(await readFile(file)); const parsed = ProductImportSchema.safeParse(raw); if (!parsed.success) { setError("导入文件必须是 { items: [...] }，最多 20 个完整商品。"); return; } const result = await importProducts(parsed.data); if (alive.current) { setImportResult(result.items); setNotice("导入已完成；已有 SKU 不会被覆盖。请刷新商品列表后再选择批次输入。"); await load(); } }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setImportBusy(false); }
  }

  return <main className="products-page batch-page"><header className="products-page-heading"><div><p className="products-eyebrow">批量文案</p><h1>批量任务</h1><p>每个商品固定当前资料和文案基准版本；创建与执行分开，失败项只能显式创建新批次重试。</p></div><button type="button" disabled={loading || busy} onClick={() => void load().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>刷新批次</button></header>
    {error ? <p className="products-error" role="alert">{error}<button type="button" disabled={loading || busy} onClick={() => void loadHistory(requestedHistoryOffset.current).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>重试读取批次</button></p> : null}{notice ? <p className="studio-notice" role="status">{notice}</p> : null}
    <section className="studio-card"><div className="studio-heading"><h2>选择已保存商品（最多 20 个）</h2><span>{drafts.length}/20</span></div><div className="batch-product-grid">{products.map(item => <label key={item.product.id} className={selectedIds.has(item.product.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.has(item.product.id)} onChange={() => toggleProduct(item.product.id)} /><span>{item.name}<small>{item.product.sku} · 资料 v{item.revisionNumber}</small></span></label>)}</div><p className="studio-help">批次输入会固定选中商品的资料版本和最新文案版本；知识版本需在各商品工作台先确认。</p></section>
    <section className="studio-card"><div className="studio-heading"><div><h2>任务输入</h2><p>默认模板模式；每个商品关键词仍可单独编辑。</p></div><button type="button" onClick={applyCommonKeywords} disabled={!drafts.length}>将公共关键词应用到全部</button></div><label>公共关键词（每行一词）<textarea rows={3} value={commonKeywords} onChange={e => setCommonKeywords(e.target.value)} /></label>{drafts.map(item => <div className="batch-item" key={item.productId}><strong>{item.detail?.currentRevision.brief.name ?? item.productId}</strong>{item.loading ? <span>正在读取当前资料…</span> : item.input ? <><span>资料 {item.input.sourceRevisionId.slice(0, 8)}… · 基准文案 {item.input.baseContentVersionId?.slice(0, 8) ?? "无"}…</span><label>关键词<textarea rows={2} value={item.input.keywords.join("\n")} onChange={e => updateKeywords(item.productId, e.target.value)} /></label></> : <span>读取失败，请取消选择后重试。</span>}</div>)}<label>完整批次 JSON（可选，需符合共享契约）<textarea rows={8} value={advancedJson} onChange={e => setAdvancedJson(e.target.value)} placeholder={'{"requestId":"…","items":[…]}'} /></label><div className="studio-actions"><button type="button" disabled={busy || !advancedJson.trim()} onClick={() => { try { applyJson(); } catch (cause) { setError(errorMessage(cause)); } }}>载入 JSON</button><button className="products-primary" type="button" disabled={busy || drafts.length === 0 || drafts.some(item => item.loading || !item.input)} onClick={() => void create().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>只创建批次</button>{pendingBatch.current?.attempted && !pendingBatch.current.created ? <button type="button" disabled={busy} onClick={() => void reconcilePending().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>核对批次 {pendingBatch.current.input.requestId.slice(0, 8)}…</button> : null}{dirty ? <span className="studio-dirty">批次输入有未保存内容</span> : null}</div></section>
    <section className="studio-card"><div className="studio-heading"><h2>批次记录</h2><span>不会自动执行历史待执行任务</span></div>{batches.length ? <ul className="studio-history-list">{batches.map(item => <li key={item.id}><button type="button" onClick={() => void viewBatch(item.id).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>{item.id.slice(0, 8)}…</button> <span>{batchStatus(item.status)} · {item.items.length} 项</span></li>)}</ul> : <p>当前页暂无批次记录。</p>}{batchPage && batchPage.total > batchPage.limit ? <div className="products-pagination"><button type="button" disabled={loading || busy || batchPage.offset === 0} onClick={() => void loadHistory(Math.max(0, batchPage.offset - batchPage.limit)).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>上一页批次</button><span>共 {batchPage.total} 个批次</span><button type="button" disabled={loading || busy || batchPage.offset + batchPage.limit >= batchPage.total} onClick={() => void loadHistory(batchPage.offset + batchPage.limit).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下一页批次</button></div> : null}{current ? <article className="studio-detail"><h3>当前批次 {current.id.slice(0, 8)}… · {batchStatus(current.status)}</h3><ul>{current.items.map(item => <li key={item.id}>{item.productId.slice(0, 8)}… · {batchStatus(item.status)}{item.errorMessage ? ` · ${item.errorMessage}` : ""}</li>)}</ul><div className="studio-actions"><button type="button" disabled={busy || current.status !== "queued"} onClick={() => void execute().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>明确执行</button><button type="button" disabled={busy || !current.items.some(item => item.status === "failed" || item.status === "interrupted")} onClick={() => void retryFailed().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>失败项新建重试批次</button></div></article> : null}</section>
    <section className="studio-card"><div className="studio-heading"><h2>导入商品 JSON（最多 20 个）</h2><label className="studio-file-input">选择 JSON <input type="file" accept="application/json,.json" disabled={importBusy} onChange={e => void importFile(e.target.files?.[0]).catch(cause => { if (alive.current) setError(errorMessage(cause)); })} /></label></div>{importResult ? <ul className="studio-import-results">{importResult.map(item => <li key={item.index}>{item.index + 1}. {item.sku} · {item.status === "created" ? `已创建 ${item.productId ?? ""}` : `失败 ${item.errorMessage ?? ""}${item.productId ? `（已有商品 ${item.productId}）` : ""}`}</li>)}</ul> : <p>导入结果会逐项显示；导入失败不会覆盖已有商品。</p>}</section>
  </main>;
}
