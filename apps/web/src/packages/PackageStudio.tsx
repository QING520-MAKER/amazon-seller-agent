import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentDetail, ContentPackage, ContentVersion, CreateContentPackage, ImageDetail, ImageVersion, ProductDetail } from "../../../../src/schemas.js";
import { errorMessage } from "../products/api.js";
import { getContentDetail, listContent } from "../content/api.js";
import { getImageDetail, listImages } from "../image/api.js";
import { createPackage, downloadPackage, getPackage, listPackages, randomRequestId } from "./api.js";

function decision(detail: { review: { decision: "approved" | "rejected" } | null; stale: boolean }) {
  return detail.review?.decision === "approved" && !detail.stale;
}
function sourceLabel(value: string) { return value === "template" ? "本地模板" : value === "model" ? "模型生成" : "人工编辑"; }

function PackageStatus({ value }: { value: "draft" | "approved" }) {
  return <span className={`studio-status studio-status-${value}`}>{value === "approved" ? "正式" : "草稿"}</span>;
}
type PendingCreate = { input: CreateContentPackage; created?: ContentPackage };
function createKey(input: Pick<CreateContentPackage, "contentVersionId" | "imageVersionIds" | "status">) {
  return JSON.stringify({ contentVersionId: input.contentVersionId, imageVersionIds: input.imageVersionIds, status: input.status });
}

export function PackageStudio({ product, onDirty, disabled = false, refreshKey = 0 }: { product: ProductDetail; onDirty?: (dirty: boolean) => void; disabled?: boolean; refreshKey?: number }) {
  const productId = product.product.id;
  const [contents, setContents] = useState<ContentVersion[]>([]);
  const [contentDetails, setContentDetails] = useState<Record<string, ContentDetail>>({});
  const [images, setImages] = useState<ImageVersion[]>([]);
  const [imageDetails, setImageDetails] = useState<Record<string, ImageDetail>>({});
  const [packages, setPackages] = useState<ContentPackage[]>([]);
  const [selectedContentId, setSelectedContentId] = useState("");
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"draft" | "approved">("draft");
  const [baseDraft, setBaseDraft] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<ContentPackage>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const detailRequest = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  const sequence = useRef(0);
  const initialized = useRef(false);
  const userEdited = useRef(false);
  const pendingCreate = useRef<PendingCreate | undefined>(undefined);
  const draftKey = JSON.stringify({ selectedContentId, selectedImageIds, status });
  const dirty = userEdited.current && Boolean(baseDraft) && draftKey !== baseDraft;

  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); detailRequest.current?.abort(); onDirty?.(false); }; }, [onDirty]);
  useEffect(() => { initialized.current = false; userEdited.current = false; pendingCreate.current = undefined; setSelectedContentId(""); setSelectedImageIds([]); setStatus("draft"); setBaseDraft(""); setSelectedPackage(undefined); }, [productId]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; const current = ++sequence.current;
    setLoading(true); setError("");
    const results = await Promise.allSettled([
      listContent(productId, 0, 30, controller.signal),
      listImages(productId, 0, 30, controller.signal),
      listPackages(productId, 0, 30, controller.signal),
    ]);
    if (!alive.current || controller.signal.aborted || current !== sequence.current) return;
    const [contentResult, imageResult, packageResult] = results;
    const rejected = results.find(item => item.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected && !(rejected.reason instanceof DOMException && rejected.reason.name === "AbortError")) setError(errorMessage(rejected.reason));
    if (contentResult?.status === "fulfilled") {
      setContents(contentResult.value.items);
      const ids = contentResult.value.items.map(item => item.id);
      const details = await Promise.allSettled(ids.map(id => getContentDetail(productId, id, controller.signal)));
      if (!alive.current || controller.signal.aborted || current !== sequence.current) return;
      const next: Record<string, ContentDetail> = {};
      details.forEach((item, index) => { const id = ids[index]; if (item.status === "fulfilled" && id) next[id] = item.value; });
      setContentDetails(next);
      setSelectedContentId(old => old && ids.includes(old) ? old : contentResult.value.headVersionId && ids.includes(contentResult.value.headVersionId) ? contentResult.value.headVersionId : ids[0] || "");
    }
    if (imageResult?.status === "fulfilled") {
      setImages(imageResult.value.items);
      const ids = imageResult.value.items.map(item => item.id);
      const details = await Promise.allSettled(ids.map(id => getImageDetail(productId, id, controller.signal)));
      if (!alive.current || controller.signal.aborted || current !== sequence.current) return;
      const next: Record<string, ImageDetail> = {};
      details.forEach((item, index) => { const id = ids[index]; if (item.status === "fulfilled" && id) next[id] = item.value; });
      setImageDetails(next);
      setSelectedImageIds(old => old.filter(id => ids.includes(id)));
    }
    if (packageResult?.status === "fulfilled") setPackages(packageResult.value.items);
    if (!initialized.current && alive.current) {
      const initialContentId = contentResult?.status === "fulfilled" ? contentResult.value.headVersionId ?? contentResult.value.items[0]?.id ?? "" : "";
      const initialImages = selectedImageIds;
      setSelectedContentId(initialContentId);
      setSelectedImageIds(initialImages);
      setBaseDraft(JSON.stringify({ selectedContentId: initialContentId, selectedImageIds: initialImages, status: "draft" }));
      initialized.current = true;
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => { void load().catch(cause => { if (alive.current) setError(errorMessage(cause)); }); return () => request.current?.abort(); }, [load, product.currentRevision.id, refreshKey]);

  const selectedContent = useMemo(() => contentDetails[selectedContentId], [contentDetails, selectedContentId]);
  const selectedImages = useMemo(() => selectedImageIds.map(id => imageDetails[id]).filter((value): value is ImageDetail => Boolean(value)), [imageDetails, selectedImageIds]);
  const canApprove = Boolean(selectedContent && decision(selectedContent) && selectedImageIds.length > 0 && selectedImages.length === selectedImageIds.length && selectedImages.every(item => decision(item)));

  function selectImage(id: string) {
    userEdited.current = true;
    setSelectedImageIds(old => old.includes(id) ? old.filter(value => value !== id) : old.length >= 9 ? old : [...old, id]);
  }
  function moveImage(index: number, direction: -1 | 1) {
    userEdited.current = true;
    setSelectedImageIds(old => { const target = index + direction; if (target < 0 || target >= old.length) return old; const next = [...old]; const value = next[index]; next[index] = next[target]!; next[target] = value!; return next; });
  }

  async function create(statusToCreate: "draft" | "approved") {
    if (busy || disabled) return;
    if (!selectedContentId || selectedImageIds.length < 1) { setError("请先选择一份文案和至少一张图片。"); return; }
    if (statusToCreate === "approved" && !canApprove) { setError("正式内容包要求文案与所有图片均已批准且未过期。"); return; }
    const selection = { contentVersionId: selectedContentId, imageVersionIds: selectedImageIds, status: statusToCreate } as const;
    const previous = pendingCreate.current;
    const input = previous && createKey(previous.input) === createKey(selection)
      ? previous.input
      : { requestId: randomRequestId(), ...selection };
    if (!previous || createKey(previous.input) !== createKey(selection)) pendingCreate.current = { input };
    setBusy(true); setError(""); setNotice("");
    try {
      let created = pendingCreate.current?.created;
      if (!created) {
        created = await createPackage(productId, input);
        if (!alive.current) return;
        pendingCreate.current = { input, created };
      }
      let snapshot: ContentPackage;
      try {
        snapshot = await getPackage(productId, created.id);
      } catch (cause) {
        if (!alive.current) return;
        // POST succeeded, so the immutable DTO is safe to show while a later read is retried with the same request.
        setSelectedPackage(created); userEdited.current = false; setStatus(statusToCreate); setBaseDraft(JSON.stringify({ selectedContentId, selectedImageIds, status: statusToCreate }));
        setNotice(`内容包已创建，但快照读取失败；已保留 requestId ${input.requestId}，再次点击将只重读快照。`);
        setError(errorMessage(cause));
        return;
      }
      if (!alive.current) return;
      pendingCreate.current = undefined;
      setSelectedPackage(snapshot); userEdited.current = false; setStatus(statusToCreate); setBaseDraft(JSON.stringify({ selectedContentId, selectedImageIds, status: statusToCreate }));
      setNotice(statusToCreate === "approved" ? "正式内容包已创建并读取快照。" : "草稿内容包已创建并读取快照。");
      try { const page = await listPackages(productId, 0, 30); if (alive.current) setPackages(page.items); }
      catch (cause) { if (alive.current) setNotice(`内容包已创建并读取快照，但历史列表刷新失败：${errorMessage(cause)}`); }
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

  async function viewPackage(id: string) {
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller;
    setError("");
    try { const value = await getPackage(productId, id, controller.signal); if (alive.current && !controller.signal.aborted) setSelectedPackage(value); }
    catch (cause) { if (alive.current && !controller.signal.aborted) setError(errorMessage(cause)); }
  }

  async function download(id: string) {
    setBusy(true); setError("");
    try { const result = await downloadPackage(productId, id); if (!alive.current) return; const url = URL.createObjectURL(result.blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `content-package-${id}.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section className="studio-card package-studio">
    <div className="studio-heading"><div><p className="products-eyebrow">内容包</p><h2>内容包工作台</h2><p>固定具体文案版本和有序图片版本。正式包创建与下载都会再次核对批准和过期状态。</p></div><button type="button" disabled={loading || busy} onClick={() => void load().catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>刷新包依据</button></div>
    {error ? <p className="products-error" role="alert">{error}</p> : null}{notice ? <p className="studio-notice" role="status">{notice}</p> : null}
    <fieldset disabled={disabled || busy}><div className="studio-columns">
      <div><h3>选择文案版本</h3>{contents.length ? <div className="studio-choice-list">{contents.map(content => <label key={content.id} className={content.id === selectedContentId ? "selected" : ""}><input type="radio" name={`package-content-${productId}`} checked={content.id === selectedContentId} onChange={() => { userEdited.current = true; setSelectedContentId(content.id); }} /><span>v{content.versionNumber} · {sourceLabel(content.source)} {content.id === selectedContentId ? selectedContent?.stale ? "· 过期" : selectedContent?.review?.decision === "approved" ? "· 已批准" : "· 待审核" : ""}</span></label>)}</div> : <p>暂无文案候选。</p>}</div>
      <div><h3>选择图片（按顺序，最多 9 张）</h3>{images.length ? <div className="studio-choice-list">{images.map(image => { const imageDetail = imageDetails[image.id]; const label = imageDetail ? imageDetail.stale ? "· 过期" : imageDetail.review?.decision === "approved" ? "· 已批准" : "· 待审核" : "· 读取中"; return <label key={image.id} className={selectedImageIds.includes(image.id) ? "selected" : ""}><input type="checkbox" checked={selectedImageIds.includes(image.id)} onChange={() => selectImage(image.id)} /><span>v{image.versionNumber} · {image.plan.headline} {label}</span></label>; })}</div> : <p>暂无图片候选。</p>}{selectedImageIds.length ? <ol className="studio-order-list">{selectedImageIds.map((id, index) => <li key={id}>图片 v{imageDetails[id]?.image.versionNumber ?? "?"}<button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0}>上移</button><button type="button" onClick={() => moveImage(index, 1)} disabled={index === selectedImageIds.length - 1}>下移</button></li>)}</ol> : null}</div>
    </div><div className="studio-actions"><button type="button" disabled={busy || disabled || !selectedContentId || selectedImageIds.length < 1} onClick={() => void create("draft").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>制作草稿包</button><button className="products-primary" type="button" disabled={busy || disabled || !canApprove} onClick={() => void create("approved").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>制作正式包</button>{dirty ? <span className="studio-dirty">内容包选择有未保存草稿</span> : null}</div></fieldset>
    <div className="studio-columns"><div><h3>内容包历史</h3>{packages.length ? <ul className="studio-history-list">{packages.map(item => <li key={item.id}><button type="button" onClick={() => void viewPackage(item.id).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>包 v{item.versionNumber}</button> <PackageStatus value={item.manifest.status} /> <small>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</small><button type="button" disabled={busy} onClick={() => void download(item.id).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下载 ZIP</button></li>)}</ul> : <p>还没有内容包。</p>}</div><div>{selectedPackage ? <article className="studio-detail"><h3>包 v{selectedPackage.versionNumber} 快照 <PackageStatus value={selectedPackage.manifest.status} /></h3><p>SKU {selectedPackage.manifest.sku} · 固定文案 v{selectedPackage.manifest.content.content.versionNumber} · {selectedPackage.manifest.images.length} 张图片</p><button type="button" disabled={busy} onClick={() => void download(selectedPackage.id).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下载此快照 ZIP</button></article> : <p>选择历史包查看不可变快照。</p>}</div></div>
  </section>;
}
