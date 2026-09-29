import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ImageDetail,
  ImagePlan,
  ImageRun,
  ImageVersion,
  OriginalAsset,
  ProductDetail,
} from "../../../../src/schemas.js";
import { errorMessage, listAssets, contentUrl } from "../products/api.js";
import {
  generateImage,
  getImageDetail,
  getImageBlob,
  listImageRuns,
  listImages,
  randomRequestId,
  reviewImage,
} from "./api.js";

function clip(value: string, max: number) { return value.slice(0, max); }

function initialPlan(product: ProductDetail): ImagePlan {
  const brief = product.currentRevision.brief;
  return {
    purpose: "feature",
    headline: clip(brief.name, 80) || "商品卖点",
    captions: brief.features.slice(0, 3).map(value => clip(value, 100)),
    prompt: "",
  };
}

function assetLabel(asset: OriginalAsset) {
  return `${asset.originalName} · v${asset.version} · ${asset.width}×${asset.height}`;
}

function RunStatus({ run }: { run: ImageRun }) {
  const label = { running: "运行中", succeeded: "成功", failed: "失败", interrupted: "中断" }[run.status];
  return <span className={`studio-status studio-status-${run.status}`}>{label}</span>;
}

function CandidateCard({ productId, detail, onSelect }: { productId: string; detail: ImageDetail; onSelect: () => void }) {
  const image = detail.image;
  return <button className="studio-candidate" type="button" onClick={onSelect}>
    <img src={`/api/products/${productId}/images/${image.id}/content`} alt={image.plan.headline} />
    <span><b>候选 v{image.versionNumber}</b> · {image.mode === "local" ? "本地排版" : "模型"}</span>
    <small>{detail.stale ? `需复核：${detail.staleReasons.join("、")}` : detail.review?.decision === "approved" ? "已批准" : detail.review?.decision === "rejected" ? "已退回" : "待审核"}</small>
  </button>;
}

export function ImageStudio({ product, knowledgeRevisionIds = [], onDirty, disabled = false, refreshKey = 0 }: {
  product: ProductDetail;
  knowledgeRevisionIds?: string[];
  onDirty?: (dirty: boolean) => void;
  disabled?: boolean;
  refreshKey?: number;
}) {
  const productId = product.product.id;
  const [assets, setAssets] = useState<OriginalAsset[]>([]);
  const [images, setImages] = useState<ImageVersion[]>([]);
  const [imageDetails, setImageDetails] = useState<Record<string, ImageDetail>>({});
  const [runs, setRuns] = useState<ImageRun[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [plan, setPlan] = useState<ImagePlan>(() => initialPlan(product));
  const [basePlan, setBasePlan] = useState(() => JSON.stringify(initialPlan(product)));
  const [mode, setMode] = useState<"local" | "model">("local");
  const [detail, setDetail] = useState<ImageDetail>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [baseNotes, setBaseNotes] = useState("");
  const [draftRequestId, setDraftRequestId] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const detailRequest = useRef<AbortController | undefined>(undefined);
  const token = useRef(0);
  const alive = useRef(true);
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

  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); detailRequest.current?.abort(); onDirty?.(false); }; }, [onDirty]);
  useEffect(() => { setPlan(initialPlan(product)); setBasePlan(JSON.stringify(initialPlan(product))); setMode("local"); setDraftRequestId(undefined); }, [productId, product.currentRevision.id]);
  useEffect(() => { onDirty?.(planDirty || reviewDirty); }, [onDirty, planDirty, reviewDirty]);

  const load = useCallback(async (protectReview = false) => {
    if (protectReview && !confirmReviewDiscard()) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; const current = ++token.current;
    setLoading(true); setError("");
    const results = await Promise.allSettled([
      listAssets(productId, "active", 0, controller.signal),
      listImages(productId, 0, 30, controller.signal),
      listImageRuns(productId, 0, 30, controller.signal),
    ]);
    if (!alive.current || controller.signal.aborted || current !== token.current) return;
    const [assetResult, imageResult, runResult] = results;
    const failed = results.find(item => item.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed && !(failed.reason instanceof DOMException && failed.reason.name === "AbortError")) setError(errorMessage(failed.reason));
    if (assetResult?.status === "fulfilled") {
      setAssets(assetResult.value.items);
      setSelectedAssetId(old => assetResult.value.items.some(item => item.id === old) ? old : assetResult.value.items[0]?.id ?? "");
    }
    if (imageResult?.status === "fulfilled") {
      setImages(imageResult.value.items);
      const details = await Promise.allSettled(imageResult.value.items.map(item => getImageDetail(productId, item.id, controller.signal)));
      if (!alive.current || controller.signal.aborted || current !== token.current) return;
      const next: Record<string, ImageDetail> = {};
      details.forEach((item, index) => { if (item.status === "fulfilled") { const image = imageResult.value.items[index]; if (image) next[image.id] = item.value; } });
      setImageDetails(next);
    }
    if (runResult?.status === "fulfilled") setRuns(runResult.value.items);
    setLoading(false);
  }, [productId]);

  useEffect(() => { void load().catch(cause => { if (alive.current) setError(errorMessage(cause)); }); return () => request.current?.abort(); }, [load, product.currentRevision.id, refreshKey]);

  const selectedAsset = useMemo(() => assets.find(asset => asset.id === selectedAssetId), [assets, selectedAssetId]);
  const loadDetail = useCallback(async (imageId: string, protectReview = true) => {
    if (protectReview && !confirmReviewDiscard()) return false;
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setError("");
    try {
      const value = await getImageDetail(productId, imageId, controller.signal);
      if (alive.current && !controller.signal.aborted) { const loadedNotes = value.review?.notes ?? ""; setDetail(value); setNotes(loadedNotes); setBaseNotes(loadedNotes); return true; }
    } catch (cause) { if (alive.current && !controller.signal.aborted) setError(errorMessage(cause)); }
    return false;
  }, [productId]);

  async function generate() {
    if (busy || disabled || !selectedAsset) { if (!selectedAsset) setError("请先选择一张有效原图。"); return; }
    // Generating a new candidate replaces the selected detail. Give an
    // unsaved review note the same protection as refresh and candidate
    // navigation so it cannot disappear as a side effect of generation.
    if (!confirmReviewDiscard()) return;
    setBusy(true); setError(""); setNotice("");
    const requestId = draftRequestId ?? randomRequestId();
    setDraftRequestId(requestId);
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
      if (result.run.status === "failed" || !result.image) {
        setNotice(`图片任务${result.run.errorMessage ? `：${result.run.errorMessage}` : "失败"}（requestId ${requestId}）。可用“核对任务”读取服务器记录。`);
      } else {
        setBasePlan(JSON.stringify(plan)); setDraftRequestId(undefined); setNotice("候选已生成，正在读取真实审核与过期状态…");
        // The result is only an acknowledgement; detail is the source of review/stale truth.
        await loadDetail(result.image.id, false);
        if (!alive.current) return;
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
      const page = await listImageRuns(productId, 0, 50);
      if (!alive.current) return;
      const run = page.items.find(item => item.requestId === draftRequestId);
      if (!run) setNotice("暂未找到该 requestId 的任务记录，保留当前 requestId 供稍后核对。");
      else if (run.imageVersionId) { if (await loadDetail(run.imageVersionId, true)) setNotice("已读取服务器任务记录与真实候选状态。"); }
      else setNotice(`任务状态：${run.status}${run.errorMessage ? `，${run.errorMessage}` : ""}。`);
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

  async function download() {
    if (!detail || busy) return;
    setBusy(true); setError("");
    try {
      const blob = await getImageBlob(productId, detail.image.id, true);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `image-v${detail.image.versionNumber}.${detail.image.mimeType === "image/jpeg" ? "jpg" : "png"}`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section className="studio-card image-studio">
    <div className="studio-heading"><div><p className="products-eyebrow">图片候选</p><h2>图片工作台</h2><p>原图、资料版本与已确认知识会固定在本次任务中。候选生成后仍需人工审核。</p></div><button type="button" disabled={loading || busy} onClick={() => void load(true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>刷新图片依据</button></div>
    {error ? <p className="products-error" role="alert">{error}</p> : null}
    {notice ? <p className="studio-notice" role="status">{notice}</p> : null}
    <fieldset disabled={disabled || busy}>
      <div className="studio-columns">
        <div><h3>选择有效原图</h3>{assets.length ? <div className="studio-asset-list">{assets.map(asset => <button className={asset.id === selectedAssetId ? "studio-asset selected" : "studio-asset"} type="button" key={asset.id} onClick={() => setSelectedAssetId(asset.id)}><img src={contentUrl(productId, asset.id)} alt={asset.originalName} /><span>{assetLabel(asset)}</span></button>)}</div> : <p>暂无 active 原图，请先在原图区上传。</p>}</div>
        <div className="studio-form"><label>模式<select value={mode} onChange={e => setMode(e.target.value as "local" | "model")}><option value="local">本地卖点图（1600×1600）</option><option value="model">场景 / 模型（需配置服务商）</option></select></label>
          <label>用途<select value={plan.purpose} onChange={e => setPlan(old => ({ ...old, purpose: e.target.value as ImagePlan["purpose"] }))}><option value="feature">卖点图</option><option value="scene">场景图</option></select></label>
          <label>标题（≤80）<input maxLength={80} value={plan.headline} onChange={e => setPlan(old => ({ ...old, headline: e.target.value }))} /></label>
          <label>文案（每行一条，≤3 条）<textarea rows={3} value={plan.captions.join("\n")} onChange={e => setPlan(old => ({ ...old, captions: e.target.value.split(/\r?\n/).map(v => clip(v, 100)).filter(Boolean).slice(0, 3) }))} /></label>
          <label>模型提示词（≤2000；本地模式可留空）<textarea maxLength={2000} rows={4} value={plan.prompt} onChange={e => setPlan(old => ({ ...old, prompt: e.target.value }))} /></label>
          <p className="studio-help">默认内容只取当前商品名称和真实卖点事实，不会填入虚构卖点。已选择知识版本：{knowledgeRevisionIds.length} 条。</p>
          <button className="products-primary" type="button" disabled={!selectedAsset || busy || disabled} onClick={() => void generate().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>{busy ? "处理中…" : mode === "model" ? "提交模型任务" : "生成本地卖点图"}</button>
          {draftRequestId ? <button type="button" disabled={busy} onClick={() => void reconcile().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>核对任务 {draftRequestId.slice(0, 8)}…</button> : null}
          {planDirty ? <span className="studio-dirty">图片方案有未保存草稿</span> : null}
        </div>
      </div>
    </fieldset>
    <div className="studio-columns studio-candidates"><div><h3>候选历史</h3>{images.length ? <div className="studio-candidate-grid">{images.map(image => { const candidate = imageDetails[image.id]; return candidate ? <CandidateCard key={image.id} productId={productId} detail={candidate} onSelect={() => void loadDetail(image.id, true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })} /> : <p key={image.id}>正在读取候选 v{image.versionNumber} 的审核状态…</p>; })}</div> : <p>还没有图片候选。</p>}</div><div><h3>运行记录</h3>{runs.length ? <ul className="studio-run-list">{runs.map(run => <li key={run.id}><span>{run.requestId.slice(0, 8)}…</span> <RunStatus run={run} /> {run.errorMessage ? <small>{run.errorMessage}</small> : null} {run.imageVersionId ? <button type="button" onClick={() => void loadDetail(run.imageVersionId!, true).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>查看候选</button> : null}</li>)}</ul> : <p>暂无运行记录。</p>}</div></div>
    {detail ? <article className="studio-detail"><div className="studio-heading"><div><h3>候选 v{detail.image.versionNumber} · {detail.image.plan.headline}</h3><p>{detail.stale ? `过期：${detail.staleReasons.join("、")}` : "当前依据未发现过期原因"} · 绑定资料 revision {detail.image.sourceRevisionId}</p></div><div><button type="button" disabled={busy} onClick={() => void download().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下载 PNG</button></div></div><div className="studio-compare"><figure><img src={contentUrl(productId, detail.image.original.id)} alt="原图" /><figcaption>原图 · {assetLabel(detail.image.original)}</figcaption></figure><figure><img src={`/api/products/${productId}/images/${detail.image.id}/content`} alt={detail.image.plan.headline} /><figcaption>候选 · {detail.image.width}×{detail.image.height} · {detail.image.provider}{detail.image.model ? ` / ${detail.image.model}` : ""}</figcaption></figure></div><p>审核状态：{detail.review?.decision === "approved" ? "已批准" : detail.review?.decision === "rejected" ? "已退回" : "待人工审核"}</p><label>审核备注<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>{reviewDirty ? <span className="studio-dirty">审核备注有未保存改动</span> : null}<p>证据：{detail.image.evidence.length ? detail.image.evidence.map(item => item.title).join("、") : "暂无证据"}</p><div className="studio-actions"><button type="button" disabled={busy || detail.stale || disabled} onClick={() => void decide("approved").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>批准此候选</button><button type="button" disabled={busy || disabled} onClick={() => void decide("rejected").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>退回此候选</button></div></article> : null}
  </section>;
}
