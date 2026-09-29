import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ImageDetail,
  ImagePlan,
  ImageRun,
  ImageVersion,
  OriginalAsset,
  Page,
  ProductDetail,
} from "../../../../src/schemas.js";
import { calculateImageLayout, IMAGE_CANVAS_SIZE } from "../../../../src/image/layout.js";
import { errorMessage, listAssets, contentUrl } from "../products/api.js";
import {
  generateImage,
  getImageDetail,
  IMAGE_CANDIDATE_PAGE_SIZE,
  IMAGE_RUN_PAGE_SIZE,
  listImageRuns,
  listImages,
  randomRequestId,
  reviewImage,
} from "./api.js";
import { DownloadLink, imageDownloadUrl } from "../shared/DownloadLink.js";

function clip(value: string, max: number) { return value.slice(0, max); }

function initialPlan(product: ProductDetail): ImagePlan {
  const brief = product.currentRevision.brief;
  return {
    purpose: "feature",
    headline: clip(brief.name, 80) || "商品卖点",
    captions: brief.features.slice(0, 3).map(value => clip(value, 100)),
    prompt: "",
    template: { layout: "split", version: 2 },
  };
}

function assetLabel(asset: OriginalAsset) {
  return `${asset.originalName} · v${asset.version} · ${asset.width}×${asset.height}`;
}

function templateLabel(plan: ImagePlan) {
  return plan.template ? `v${plan.template.version} ${plan.template.layout === "split" ? "左右分栏" : "上下堆叠"}` : "历史版式";
}

function RunStatus({ run }: { run: ImageRun }) {
  const label = { running: "运行中", succeeded: "成功", failed: "失败", interrupted: "中断" }[run.status];
  return <span className={`studio-status studio-status-${run.status}`}>{label}</span>;
}

function CandidateCard({ productId, detail, onSelect }: { productId: string; detail: ImageDetail; onSelect: () => void }) {
  const image = detail.image;
  return <button className="studio-candidate" type="button" onClick={onSelect}>
    <img src={`/api/products/${productId}/images/${image.id}/content`} alt={image.plan.headline} />
    <span><b>候选 v{image.versionNumber}</b> · {image.mode === "local" ? "本地排版" : "模型"} · {templateLabel(image.plan)}</span>
    <small>{detail.stale ? `需复核：${detail.staleReasons.join("、")}` : detail.review?.decision === "approved" ? "已批准" : detail.review?.decision === "rejected" ? "已退回" : "待审核"}</small>
  </button>;
}

function TemplatePreview({ plan }: { plan: ImagePlan }) {
  const layout = calculateImageLayout(plan);
  const image = layout.image;
  const titleLines = layout.title.lines;
  return <div className="studio-template-preview">
    <svg viewBox={`0 0 ${IMAGE_CANVAS_SIZE} ${IMAGE_CANVAS_SIZE}`} role="img" aria-label={`v2 ${layout.layout} 布局示意`}>
      <rect x="0" y="0" width={IMAGE_CANVAS_SIZE} height={IMAGE_CANVAS_SIZE} fill="#f2f4ef" />
      <rect x={layout.safeArea.x} y={layout.safeArea.y} width={layout.safeArea.width} height={layout.safeArea.height} fill="none" stroke="#b8c7bc" strokeDasharray="18 12" />
      <rect x={image.x} y={image.y} width={image.width} height={image.height} fill="#d9e1d9" stroke="#2a6258" />
      {titleLines.map((line, index) => <text key={`title-${index}`} x={layout.title.x} y={layout.title.y + index * layout.title.lineHeight} fontSize="44" fill="#152d2b">{line}</text>)}
      {layout.captions.map((caption, index) => <g key={`caption-${index}`}><circle cx={caption.markerX ?? caption.x - 42} cy={(caption.markerY ?? caption.y - 10) - 12} r="16" fill="#2a6258" /><rect x={caption.x} y={caption.y - 36} width={Math.min(caption.width, 480)} height="48" fill="#d9e1d9" /></g>)}
    </svg>
    <p>v2 {layout.layout === "split" ? "左右分栏" : "上下堆叠"} · 安全边距 {layout.safeArea.x}px · 原图框 {image.width}×{image.height}</p>
  </div>;
}

function Pagination({ label, data, onPrevious, onNext }: { label: string; data?: Page<unknown>; onPrevious: () => void; onNext: () => void }) {
  if (!data || data.total <= data.limit) return null;
  return <div className="studio-pagination">
    <span>{label} · 共 {data.total} 条 · 第 {Math.floor(data.offset / data.limit) + 1} 页</span>
    <button type="button" disabled={data.offset === 0} onClick={onPrevious}>上一页</button>
    <button type="button" disabled={data.offset + data.limit >= data.total} onClick={onNext}>下一页</button>
  </div>;
}

export function ImageStudio({ product, knowledgeRevisionIds = [], onDirty, disabled = false, refreshKey = 0 }: {
  product: ProductDetail;
  knowledgeRevisionIds?: string[];
  onDirty?: (dirty: boolean) => void;
  disabled?: boolean;
  refreshKey?: number;
}) {
  const productId = product.product.id;
  const sourceRevisionId = product.currentRevision.id;
  const [assetData, setAssetData] = useState<Page<OriginalAsset>>();
  const [imageData, setImageData] = useState<Page<ImageVersion>>();
  const [runData, setRunData] = useState<Page<ImageRun>>();
  const [imageDetails, setImageDetails] = useState<Record<string, ImageDetail>>({});
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<OriginalAsset>();
  const [plan, setPlan] = useState<ImagePlan>(() => initialPlan(product));
  const [basePlan, setBasePlan] = useState(() => JSON.stringify(initialPlan(product)));
  const [mode, setMode] = useState<"local" | "model">("local");
  const [detail, setDetail] = useState<ImageDetail>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [notes, setNotes] = useState("");
  const [baseNotes, setBaseNotes] = useState("");
  const [draftRequestId, setDraftRequestId] = useState<string>();
  const [pendingImageId, setPendingImageId] = useState<string>();
  const [terminalRetryAvailable, setTerminalRetryAvailable] = useState(false);
  const [terminalRetryInputKey, setTerminalRetryInputKey] = useState("");
  const [assetOffset, setAssetOffset] = useState(0);
  const [imageOffset, setImageOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const assetRequest = useRef<AbortController | undefined>(undefined);
  const imageRequest = useRef<AbortController | undefined>(undefined);
  const runRequest = useRef<AbortController | undefined>(undefined);
  const detailRequest = useRef<AbortController | undefined>(undefined);
  const assetToken = useRef(0);
  const imageToken = useRef(0);
  const runToken = useRef(0);
  const detailToken = useRef(0);
  const selectedAssetIdRef = useRef("");
  const draftInputKey = useRef("");
  const alive = useRef(true);
  selectedAssetIdRef.current = selectedAssetId;
  const loading = loadingAssets || loadingImages || loadingRuns;
  const planDirty = JSON.stringify(plan) !== basePlan;
  const reviewDirty = Boolean(detail) && notes !== baseNotes;
  const reviewDirtyRef = useRef(false);
  reviewDirtyRef.current = reviewDirty;
  const baseNotesRef = useRef(baseNotes);
  baseNotesRef.current = baseNotes;

  function confirmReviewDiscard() {
    if (!reviewDirtyRef.current) return true;
    const accepted = window.confirm("审核备注尚未保存，确定放弃并继续吗？");
    if (accepted) {
      setNotes(baseNotesRef.current);
    }
    return accepted;
  }

  useEffect(() => { alive.current = true; return () => { alive.current = false; assetRequest.current?.abort(); imageRequest.current?.abort(); runRequest.current?.abort(); detailRequest.current?.abort(); onDirty?.(false); }; }, [onDirty]);
  useEffect(() => {
    detailRequest.current?.abort();
    detailToken.current += 1;
    const next = initialPlan(product);
    setPlan(next); setBasePlan(JSON.stringify(next)); setMode("local"); setDraftRequestId(undefined);
    setPendingImageId(undefined); setTerminalRetryAvailable(false); setTerminalRetryInputKey(""); draftInputKey.current = "";
    setAssetOffset(0); setImageOffset(0); setRunOffset(0); setRefreshNonce(0);
    setAssetData(undefined); setImageData(undefined); setRunData(undefined); setImageDetails({});
    setSelectedAssetId(""); setSelectedAsset(undefined); setDetail(undefined); setNotes(""); setBaseNotes("");
  }, [productId, sourceRevisionId]);
  useEffect(() => { onDirty?.(planDirty || reviewDirty); }, [onDirty, planDirty, reviewDirty]);

  const generationInputKey = JSON.stringify({ sourceRevisionId, originalAssetId: selectedAsset?.id ?? "", originalAssetVersion: selectedAsset?.version ?? 0, knowledgeRevisionIds, mode, plan });
  useEffect(() => {
    if (draftRequestId && draftInputKey.current && draftInputKey.current !== generationInputKey) {
      // A request ID is reusable only while every input byte is unchanged.
      // Changing text, layout, source asset, or mode starts a new task key.
      draftInputKey.current = "";
      setDraftRequestId(undefined);
      setPendingImageId(undefined);
      setTerminalRetryAvailable(false);
      setTerminalRetryInputKey("");
    }
  }, [draftRequestId, generationInputKey]);

  useEffect(() => {
    assetRequest.current?.abort();
    const controller = new AbortController(); assetRequest.current = controller; const current = ++assetToken.current;
    setLoadingAssets(true); setError("");
    void listAssets(productId, "active", assetOffset, controller.signal).then(value => {
      if (!alive.current || controller.signal.aborted || current !== assetToken.current) return;
      if (!value.items.length && assetOffset > 0) { setAssetOffset(0); return; }
      setAssetData(value);
      const selected = value.items.find(item => item.id === selectedAssetIdRef.current);
      if (selected) setSelectedAsset(selected);
      else if (!selectedAssetIdRef.current && value.items[0]) { setSelectedAssetId(value.items[0].id); setSelectedAsset(value.items[0]); }
    }).catch(cause => { if (alive.current && !controller.signal.aborted && current === assetToken.current) setError(errorMessage(cause)); })
      .finally(() => { if (alive.current && current === assetToken.current) setLoadingAssets(false); });
    return () => controller.abort();
  }, [productId, sourceRevisionId, assetOffset, refreshNonce, refreshKey]);

  useEffect(() => {
    imageRequest.current?.abort();
    const controller = new AbortController(); imageRequest.current = controller; const current = ++imageToken.current;
    setLoadingImages(true); setError("");
    void listImages(productId, imageOffset, IMAGE_CANDIDATE_PAGE_SIZE, controller.signal).then(async value => {
      if (!alive.current || controller.signal.aborted || current !== imageToken.current) return;
      if (!value.items.length && imageOffset > 0) { setImageOffset(0); return; }
      setImageData(value);
      const details = await Promise.allSettled(value.items.map(item => getImageDetail(productId, item.id, controller.signal)));
      if (!alive.current || controller.signal.aborted || current !== imageToken.current) return;
      const next: Record<string, ImageDetail> = {};
      details.forEach((item, index) => { if (item.status === "fulfilled") { const image = value.items[index]; if (image) next[image.id] = item.value; } });
      setImageDetails(old => ({ ...old, ...next }));
    }).catch(cause => { if (alive.current && !controller.signal.aborted && current === imageToken.current) setError(errorMessage(cause)); })
      .finally(() => { if (alive.current && current === imageToken.current) setLoadingImages(false); });
    return () => controller.abort();
  }, [productId, sourceRevisionId, imageOffset, refreshNonce, refreshKey]);

  useEffect(() => {
    runRequest.current?.abort();
    const controller = new AbortController(); runRequest.current = controller; const current = ++runToken.current;
    setLoadingRuns(true); setError("");
    void listImageRuns(productId, runOffset, IMAGE_RUN_PAGE_SIZE, controller.signal).then(value => {
      if (!alive.current || controller.signal.aborted || current !== runToken.current) return;
      if (!value.items.length && runOffset > 0) { setRunOffset(0); return; }
      setRunData(value);
    }).catch(cause => { if (alive.current && !controller.signal.aborted && current === runToken.current) setError(errorMessage(cause)); })
      .finally(() => { if (alive.current && current === runToken.current) setLoadingRuns(false); });
    return () => controller.abort();
  }, [productId, sourceRevisionId, runOffset, refreshNonce, refreshKey]);

  const load = useCallback(async (protectReview = false) => {
    if (protectReview && !confirmReviewDiscard()) return;
    setRefreshNonce(value => value + 1);
  }, []);
  const loadDetail = useCallback(async (imageId: string, protectReview = true) => {
    if (protectReview && !confirmReviewDiscard()) return false;
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller; const current = ++detailToken.current;
    setError("");
    try {
      const value = await getImageDetail(productId, imageId, controller.signal);
      if (alive.current && !controller.signal.aborted && current === detailToken.current) { const loadedNotes = value.review?.notes ?? ""; setDetail(value); setNotes(loadedNotes); setBaseNotes(loadedNotes); return true; }
    } catch (cause) { if (alive.current && !controller.signal.aborted && current === detailToken.current) setError(errorMessage(cause)); }
    return false;
  }, [productId]);

  function clearDraftRequest() {
    setDraftRequestId(undefined);
    setPendingImageId(undefined);
    setTerminalRetryAvailable(false);
    setTerminalRetryInputKey("");
    draftInputKey.current = "";
  }

  async function generate(forceNewRequest = false) {
    if (busy || disabled || !selectedAsset) { if (!selectedAsset) setError("请先选择一张有效原图。"); return; }
    if (pendingImageId) {
      setNotice("服务器已返回候选，但详情尚未确认；请先用“核对任务”读取记录，避免重复制作。");
      return;
    }
    if (terminalRetryAvailable && !forceNewRequest) {
      setNotice("该 requestId 已有失败或中断终态；请使用“用相同输入新建任务”明确重试，或先核对任务。");
      return;
    }
    if (forceNewRequest && (!terminalRetryAvailable || terminalRetryInputKey !== generationInputKey)) {
      setNotice("只有相同输入的失败或中断任务才可明确新建重试；请先核对当前输入。");
      return;
    }
    // Generating a new candidate replaces the selected detail. Give an
    // unsaved review note the same protection as refresh and candidate
    // navigation so it cannot disappear as a side effect of generation.
    if (!confirmReviewDiscard()) return;
    setBusy(true); setError(""); setNotice("");
    const requestId = forceNewRequest ? randomRequestId() : draftRequestId ?? randomRequestId();
    draftInputKey.current = generationInputKey;
    setDraftRequestId(requestId);
    setTerminalRetryAvailable(false);
    try {
      const result = await generateImage(productId, {
        requestId,
        sourceRevisionId: product.currentRevision.id,
        originalAssetId: selectedAsset.id,
        originalAssetVersion: selectedAsset.version,
        knowledgeRevisionIds,
        mode,
        plan,
      });
      if (!alive.current) return;
      if (result.run.status === "failed" || result.run.status === "interrupted" || !result.image) {
        setPendingImageId(undefined);
        setTerminalRetryAvailable(result.run.status === "failed" || result.run.status === "interrupted");
        setTerminalRetryInputKey(result.run.status === "failed" || result.run.status === "interrupted" ? generationInputKey : "");
        setNotice(`图片任务${result.run.errorMessage ? `：${result.run.errorMessage}` : "失败"}（requestId ${requestId}）。可用“核对任务”读取服务器记录。`);
      } else {
        setBasePlan(JSON.stringify(plan)); setPendingImageId(result.image.id); setNotice("候选已生成，正在读取真实审核与过期状态…");
        // The result is only an acknowledgement; detail is the source of review/stale truth.
        const confirmed = await loadDetail(result.image.id, false);
        if (!alive.current) return;
        if (!confirmed) {
          setNotice(`候选已返回，但详情读取未确认；保留 requestId ${requestId}，请用“核对任务”重读，避免重复制作。`);
          return;
        }
        clearDraftRequest();
        setNotice("候选已生成，请核对原图、来源与过期状态后审核。");
        await load(false);
      }
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

  async function reconcile() {
    if (!draftRequestId || busy) return;
    setBusy(true); setError("");
    try {
      if (pendingImageId) {
        if (await loadDetail(pendingImageId, true)) { clearDraftRequest(); setNotice("已读取服务器任务记录与真实候选状态。"); }
        else if (alive.current) setNotice("候选详情仍未确认，已保留 requestId；请稍后再次核对任务。");
        return;
      }
      const page = await listImageRuns(productId, 0, 50);
      if (!alive.current) return;
      const run = page.items.find(item => item.requestId === draftRequestId);
      if (!run) setNotice("暂未找到该 requestId 的任务记录，保留当前 requestId 供稍后核对。");
      else if (run.imageVersionId) {
        if (await loadDetail(run.imageVersionId, true)) { clearDraftRequest(); setNotice("已读取服务器任务记录与真实候选状态。"); }
      } else {
        setPendingImageId(undefined);
        setTerminalRetryAvailable(run.status === "failed" || run.status === "interrupted");
        setTerminalRetryInputKey(run.status === "failed" || run.status === "interrupted" ? generationInputKey : "");
        setNotice(`任务状态：${run.status}${run.errorMessage ? `，${run.errorMessage}` : ""}。`);
      }
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

  async function decide(decision: "approved" | "rejected") {
    if (busy || disabled || !detail || (decision === "approved" && detail.stale)) return;
    setBusy(true); setError("");
    try { await reviewImage(productId, detail.image.id, { decision, notes }); if (alive.current) { setNotice(decision === "approved" ? "已批准该具体候选。" : "已退回该具体候选。"); await loadDetail(detail.image.id, false); await load(false); } }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

  const layoutResult = calculateImageLayout(plan);
  const planLimitWarning = plan.headline.length > 80 || plan.captions.length > 3 || plan.captions.some(caption => caption.length > 100);
  return <section className="studio-card image-studio">
    <div className="studio-heading"><div><p className="products-eyebrow">图片候选</p><h2>图片工作台</h2><p>原图、资料版本与已确认知识会固定在本次任务中。候选生成后仍需人工审核。</p></div><button type="button" disabled={loading || busy} onClick={() => void load(true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>刷新图片依据</button></div>
    {error ? <p className="products-error" role="alert">{error}</p> : null}
    {notice ? <p className="studio-notice" role="status">{notice}</p> : null}
    <fieldset disabled={disabled || busy}>
      <div className="studio-columns">
        <div><h3>选择有效原图</h3>{assetData?.items.length ? <div className="studio-asset-list">{assetData.items.map(asset => <button className={asset.id === selectedAssetId ? "studio-asset selected" : "studio-asset"} type="button" key={asset.id} onClick={() => { setSelectedAssetId(asset.id); setSelectedAsset(asset); }}><img src={contentUrl(productId, asset.id)} alt={asset.originalName} /><span>{assetLabel(asset)}</span></button>)}</div> : assetData ? <p>暂无 active 原图，请先在原图区上传。</p> : <p role="status">正在读取有效原图…</p>}<Pagination label="原图" data={assetData} onPrevious={() => setAssetOffset(value => Math.max(0, value - (assetData?.limit ?? 20)))} onNext={() => setAssetOffset(value => value + (assetData?.limit ?? 20))} /></div>
        <div className="studio-form"><label>模式<select value={mode} onChange={e => setMode(e.target.value as "local" | "model")}><option value="local">本地卖点图（1600×1600）</option><option value="model">场景 / 模型（需配置服务商）</option></select></label>
          <label>用途<select value={plan.purpose} onChange={e => setPlan(old => ({ ...old, purpose: e.target.value as ImagePlan["purpose"] }))}><option value="feature">卖点图</option><option value="scene">场景图</option></select></label>
          <label>标题（≤80）<input maxLength={80} value={plan.headline} onChange={e => setPlan(old => ({ ...old, headline: e.target.value }))} /></label>
          <label>文案（每行一条，≤3 条）<textarea rows={3} value={plan.captions.join("\n")} onChange={e => setPlan(old => ({ ...old, captions: e.target.value.split(/\r?\n/).filter(value => value.length > 0) }))} /></label>
          <label>模型提示词（≤2000；本地模式可留空）<textarea maxLength={2000} rows={4} value={plan.prompt} onChange={e => setPlan(old => ({ ...old, prompt: e.target.value }))} /></label>
          <label>版式<select aria-label="图片版式" value={plan.template?.layout ?? "split"} onChange={e => setPlan(old => ({ ...old, template: { layout: e.target.value as "split" | "stacked", version: 2 } }))}><option value="split">左右分栏（v2）</option><option value="stacked">上下堆叠（v2）</option></select></label>
          <TemplatePreview plan={plan} />
          {planLimitWarning ? <p className="products-error" role="alert">标题最多 80 字符，每条卖点最多 100 字符，且最多 3 条；当前文字会被拒绝，请先缩短后再制作。</p> : null}
          {layoutResult.overflow.length ? <p className="products-error" role="alert">文字超出版式安全区域，请缩短文字或切换版式后重新制作。</p> : null}
          <p className="studio-help">默认内容只取当前商品名称和真实卖点事实，不会填入虚构卖点。已选择知识版本：{knowledgeRevisionIds.length} 条。</p>
          <button className="products-primary" type="button" disabled={!selectedAsset || busy || disabled} onClick={() => void generate().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>{busy ? "处理中…" : mode === "model" ? "提交模型任务" : "生成本地卖点图"}</button>
          {draftRequestId ? <button type="button" disabled={busy} onClick={() => void reconcile().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>核对任务 {draftRequestId.slice(0, 8)}…</button> : null}
          {terminalRetryAvailable ? <button type="button" disabled={busy || disabled} onClick={() => void generate(true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>用相同输入新建任务</button> : null}
          {pendingImageId ? <p className="studio-help" role="status">候选已返回，详情尚未确认；请先核对任务，避免重复制作。</p> : null}
          {planDirty ? <span className="studio-dirty">图片方案有未保存草稿</span> : null}
        </div>
      </div>
    </fieldset>
    <div className="studio-columns studio-candidates"><div><h3>候选历史</h3>{imageData?.items.length ? <div className="studio-candidate-grid">{imageData.items.map(image => { const candidate = imageDetails[image.id]; return candidate ? <CandidateCard key={image.id} productId={productId} detail={candidate} onSelect={() => void loadDetail(image.id, true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })} /> : <p key={image.id}>正在读取候选 v{image.versionNumber} 的审核状态…</p>; })}</div> : imageData ? <p>还没有图片候选。</p> : <p role="status">正在读取候选历史…</p>}<Pagination label="候选" data={imageData} onPrevious={() => setImageOffset(value => Math.max(0, value - (imageData?.limit ?? 20)))} onNext={() => setImageOffset(value => value + (imageData?.limit ?? 20))} /></div><div><h3>运行记录</h3>{runData?.items.length ? <ul className="studio-run-list">{runData.items.map(run => <li key={run.id}><span>{run.requestId.slice(0, 8)}…</span> <RunStatus run={run} /> {run.errorMessage ? <small>{run.errorMessage}</small> : null} {run.imageVersionId ? <button type="button" onClick={() => void loadDetail(run.imageVersionId!, true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>查看候选</button> : null}</li>)}</ul> : runData ? <p>暂无运行记录。</p> : <p role="status">正在读取运行记录…</p>}<Pagination label="运行记录" data={runData} onPrevious={() => setRunOffset(value => Math.max(0, value - (runData?.limit ?? 20)))} onNext={() => setRunOffset(value => value + (runData?.limit ?? 20))} /></div></div>
    {detail ? <article className="studio-detail"><div className="studio-heading"><div><h3>候选 v{detail.image.versionNumber} · {detail.image.plan.headline}</h3><p>{detail.stale ? `过期：${detail.staleReasons.join("、")}` : "当前依据未发现过期原因"} · 绑定资料 revision {detail.image.sourceRevisionId} · {templateLabel(detail.image.plan)}</p></div><div><DownloadLink href={imageDownloadUrl(productId, detail.image.id)} disabled={busy}>下载 {detail.image.mimeType === "image/jpeg" ? "JPEG" : "PNG"}</DownloadLink></div></div><div className="studio-compare"><figure><img src={contentUrl(productId, detail.image.original.id)} alt="原图" /><figcaption>原图 · {assetLabel(detail.image.original)}</figcaption></figure><figure><img src={`/api/products/${productId}/images/${detail.image.id}/content`} alt={detail.image.plan.headline} /><figcaption>候选 · {detail.image.width}×{detail.image.height} · {detail.image.provider}{detail.image.model ? ` / ${detail.image.model}` : ""}</figcaption></figure></div><p>审核状态：{detail.review?.decision === "approved" ? "已批准" : detail.review?.decision === "rejected" ? "已退回" : "待人工审核"}</p><label>审核备注<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>{reviewDirty ? <span className="studio-dirty">审核备注有未保存改动</span> : null}<p>证据：{detail.image.evidence.length ? detail.image.evidence.map(item => item.title).join("、") : "暂无证据"}</p><div className="studio-actions"><button type="button" disabled={busy || detail.stale || disabled} onClick={() => void decide("approved").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>批准此候选</button><button type="button" disabled={busy || disabled} onClick={() => void decide("rejected").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>退回此候选</button></div></article> : null}
  </section>;
}
