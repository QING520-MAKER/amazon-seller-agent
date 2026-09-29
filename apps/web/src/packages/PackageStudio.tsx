import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentDetail, ContentPackage, ContentVersion, CreateContentPackage, ImageDetail, ImageVersion, ProductDetail } from "../../../../src/schemas.js";
import { errorMessage } from "../products/api.js";
import { getContentDetail, listContent } from "../content/api.js";
import { getImageDetail, listImages } from "../image/api.js";
import { DownloadLink, packageDownloadUrl } from "../shared/DownloadLink.js";
import { createPackage, getPackage, listPackages, randomRequestId } from "./api.js";

function decision(detail: { review: { decision: "approved" | "rejected" } | null; stale: boolean }) {
  return detail.review?.decision === "approved" && !detail.stale;
}
function sourceLabel(value: string) { return value === "template" ? "本地模板" : value === "model" ? "模型生成" : "人工编辑"; }

function PackageStatus({ value }: { value: "draft" | "approved" }) {
  return <span className={`studio-status studio-status-${value}`}>{value === "approved" ? "正式" : "草稿"}</span>;
}
type PendingCreate = { input: CreateContentPackage; created?: ContentPackage };
type ContentPage = ReturnType<typeof listContent> extends Promise<infer T> ? T : never;
type ImagePage = ReturnType<typeof listImages> extends Promise<infer T> ? T : never;
type PackagePage = ReturnType<typeof listPackages> extends Promise<infer T> ? T : never;
function createKey(input: Pick<CreateContentPackage, "contentVersionId" | "imageVersionIds" | "status">) {
  return JSON.stringify({ contentVersionId: input.contentVersionId, imageVersionIds: input.imageVersionIds, status: input.status });
}

export function PackageStudio({ product, onDirty, disabled = false, refreshKey = 0 }: { product: ProductDetail; onDirty?: (dirty: boolean) => void; disabled?: boolean; refreshKey?: number }) {
  const productId = product.product.id;
  const [contents, setContents] = useState<ContentVersion[]>([]);
  const [contentPage, setContentPage] = useState<ContentPage>();
  const [contentDetails, setContentDetails] = useState<Record<string, ContentDetail>>({});
  const [images, setImages] = useState<ImageVersion[]>([]);
  const [imagePage, setImagePage] = useState<ImagePage>();
  const [imageDetails, setImageDetails] = useState<Record<string, ImageDetail>>({});
  const [packages, setPackages] = useState<ContentPackage[]>([]);
  const [packagePage, setPackagePage] = useState<PackagePage>();
  const pageOffsets = useRef({ content: 0, image: 0, packages: 0 });
  const requestedOffsets = useRef({ content: 0, image: 0, packages: 0 });
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
  const detailSequence = useRef(0);
  const alive = useRef(true);
  const sequence = useRef(0);
  const loadedProductId = useRef("");
  const userEdited = useRef(false);
  const pendingCreate = useRef<PendingCreate | undefined>(undefined);
  const draftKey = JSON.stringify({ selectedContentId, selectedImageIds, status });
  const dirty = userEdited.current && Boolean(baseDraft) && draftKey !== baseDraft;

  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); detailRequest.current?.abort(); onDirty?.(false); }; }, [onDirty]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const load = useCallback(async ({ contentOffset = pageOffsets.current.content, imageOffset = pageOffsets.current.image, packageOffset = pageOffsets.current.packages, resetSelection = false }: { contentOffset?: number; imageOffset?: number; packageOffset?: number; resetSelection?: boolean } = {}) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; const current = ++sequence.current;
    setLoading(true); setError("");
    requestedOffsets.current = { content: contentOffset, image: imageOffset, packages: packageOffset };
    const results = await Promise.allSettled([
      listContent(productId, contentOffset, 30, controller.signal),
      listImages(productId, imageOffset, 30, controller.signal),
      listPackages(productId, packageOffset, 30, controller.signal),
    ]);
    if (!alive.current || controller.signal.aborted || current !== sequence.current) return;
    const [contentResult, imageResult, packageResult] = results;
    const rejected = results.find(item => item.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected && !(rejected.reason instanceof DOMException && rejected.reason.name === "AbortError")) setError(errorMessage(rejected.reason));
    if (contentResult?.status === "fulfilled") {
      pageOffsets.current.content = contentResult.value.offset;
      setContentPage(contentResult.value);
      setContents(contentResult.value.items);
      const ids = contentResult.value.items.map(item => item.id);
      const details = await Promise.allSettled(ids.map(id => getContentDetail(productId, id, controller.signal)));
      if (!alive.current || controller.signal.aborted || current !== sequence.current) return;
      const next: Record<string, ContentDetail> = {};
      details.forEach((item, index) => { const id = ids[index]; if (item.status === "fulfilled" && id) next[id] = item.value; });
      setContentDetails(old => ({ ...old, ...next }));
      if (resetSelection) setSelectedContentId(contentResult.value.headVersionId ?? contentResult.value.items[0]?.id ?? "");
    }
    if (imageResult?.status === "fulfilled") {
      pageOffsets.current.image = imageResult.value.offset;
      setImagePage(imageResult.value);
      setImages(imageResult.value.items);
      const ids = imageResult.value.items.map(item => item.id);
      const details = await Promise.allSettled(ids.map(id => getImageDetail(productId, id, controller.signal)));
      if (!alive.current || controller.signal.aborted || current !== sequence.current) return;
      const next: Record<string, ImageDetail> = {};
      details.forEach((item, index) => { const id = ids[index]; if (item.status === "fulfilled" && id) next[id] = item.value; });
      setImageDetails(old => ({ ...old, ...next }));
    }
    if (packageResult?.status === "fulfilled") { pageOffsets.current.packages = packageResult.value.offset; setPackagePage(packageResult.value); setPackages(packageResult.value.items); }
    if (resetSelection && alive.current) setBaseDraft(JSON.stringify({ selectedContentId: contentResult?.status === "fulfilled" ? contentResult.value.headVersionId ?? contentResult.value.items[0]?.id ?? "" : "", selectedImageIds: [], status: "draft" }));
    loadedProductId.current = productId;
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    const resetSelection = loadedProductId.current !== productId;
    if (resetSelection) {
      detailRequest.current?.abort(); detailSequence.current += 1;
      userEdited.current = false; pendingCreate.current = undefined;
      pageOffsets.current = { content: 0, image: 0, packages: 0 };
      setContents([]); setContentPage(undefined); setContentDetails({});
      setImages([]); setImagePage(undefined); setImageDetails({}); setPackages([]); setPackagePage(undefined);
      setSelectedContentId(""); setSelectedImageIds([]); setStatus("draft"); setBaseDraft(""); setSelectedPackage(undefined);
    }
    void load({ contentOffset: resetSelection ? 0 : pageOffsets.current.content, imageOffset: resetSelection ? 0 : pageOffsets.current.image, packageOffset: resetSelection ? 0 : pageOffsets.current.packages, resetSelection }).catch(cause => { if (alive.current) setError(errorMessage(cause)); });
    return () => request.current?.abort();
  }, [load, product.product.id, product.currentRevision.id, refreshKey]);

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
      try { await load({ packageOffset: 0 }); }
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

  return <section className="studio-card package-studio">
    <div className="studio-heading"><div><p className="products-eyebrow">内容包</p><h2>内容包工作台</h2><p>固定具体文案版本和有序图片版本。正式包创建与下载都会再次核对批准和过期状态。</p></div><button type="button" disabled={loading || busy} onClick={() => void load({ contentOffset: requestedOffsets.current.content, imageOffset: requestedOffsets.current.image, packageOffset: requestedOffsets.current.packages }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>刷新包依据</button></div>
    {error ? <p className="products-error" role="alert">{error}<button type="button" disabled={loading || busy} onClick={() => void load({ contentOffset: requestedOffsets.current.content, imageOffset: requestedOffsets.current.image, packageOffset: requestedOffsets.current.packages }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>重试读取内容包</button></p> : null}{notice ? <p className="studio-notice" role="status">{notice}</p> : null}
    <fieldset disabled={disabled || busy}><div className="studio-columns">
      <div><h3>选择文案版本</h3>{contents.length ? <div className="studio-choice-list">{contents.map(content => <label key={content.id} className={content.id === selectedContentId ? "selected" : ""}><input type="radio" name={`package-content-${productId}`} checked={content.id === selectedContentId} onChange={() => { userEdited.current = true; setSelectedContentId(content.id); }} /><span>v{content.versionNumber} · {sourceLabel(content.source)} {content.id === selectedContentId ? selectedContent?.stale ? "· 过期" : selectedContent?.review?.decision === "approved" ? "· 已批准" : "· 待审核" : ""}</span></label>)}</div> : <p>当前页暂无文案候选。</p>}{contentPage && contentPage.total > contentPage.limit ? <div className="products-pagination"><button type="button" disabled={loading || busy || contentPage.offset === 0} onClick={() => void load({ contentOffset: Math.max(0, contentPage.offset - contentPage.limit) }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>上一页文案候选</button><span>共 {contentPage.total} 个版本</span><button type="button" disabled={loading || busy || contentPage.offset + contentPage.limit >= contentPage.total} onClick={() => void load({ contentOffset: contentPage.offset + contentPage.limit }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下一页文案候选</button></div> : null}</div>
      <div><h3>选择图片（按顺序，最多 9 张）</h3>{images.length ? <div className="studio-choice-list">{images.map(image => { const imageDetail = imageDetails[image.id]; const label = imageDetail ? imageDetail.stale ? "· 过期" : imageDetail.review?.decision === "approved" ? "· 已批准" : "· 待审核" : "· 读取中"; return <label key={image.id} className={selectedImageIds.includes(image.id) ? "selected" : ""}><input type="checkbox" checked={selectedImageIds.includes(image.id)} onChange={() => selectImage(image.id)} /><span>v{image.versionNumber} · {image.plan.headline} {label}</span></label>; })}</div> : <p>当前页暂无图片候选。</p>}{imagePage && imagePage.total > imagePage.limit ? <div className="products-pagination"><button type="button" disabled={loading || busy || imagePage.offset === 0} onClick={() => void load({ imageOffset: Math.max(0, imagePage.offset - imagePage.limit) }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>上一页图片候选</button><span>共 {imagePage.total} 张图片</span><button type="button" disabled={loading || busy || imagePage.offset + imagePage.limit >= imagePage.total} onClick={() => void load({ imageOffset: imagePage.offset + imagePage.limit }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下一页图片候选</button></div> : null}{selectedImageIds.length ? <ol className="studio-order-list">{selectedImageIds.map((id, index) => <li key={id}>图片 v{imageDetails[id]?.image.versionNumber ?? "?"}<button type="button" onClick={() => moveImage(index, -1)} disabled={index === 0}>上移</button><button type="button" onClick={() => moveImage(index, 1)} disabled={index === selectedImageIds.length - 1}>下移</button></li>)}</ol> : null}</div>
    </div><div className="studio-actions"><button type="button" disabled={busy || disabled || !selectedContentId || selectedImageIds.length < 1} onClick={() => void create("draft").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>制作草稿包</button><button className="products-primary" type="button" disabled={busy || disabled || !canApprove} onClick={() => void create("approved").catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>制作正式包</button>{dirty ? <span className="studio-dirty">内容包选择有未保存草稿</span> : null}</div></fieldset>
    <div className="studio-columns"><div><h3>内容包历史</h3>{packages.length ? <ul className="studio-history-list">{packages.map(item => <li key={item.id}><button type="button" onClick={() => void viewPackage(item.id).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>包 v{item.versionNumber}</button> <PackageStatus value={item.manifest.status} /> <small>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</small><DownloadLink href={packageDownloadUrl(productId, item.id)} disabled={busy}>下载 ZIP</DownloadLink></li>)}</ul> : <p>当前页暂无内容包。</p>}{packagePage && packagePage.total > packagePage.limit ? <div className="products-pagination"><button type="button" disabled={loading || busy || packagePage.offset === 0} onClick={() => void load({ packageOffset: Math.max(0, packagePage.offset - packagePage.limit) }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>上一页内容包</button><span>共 {packagePage.total} 个内容包</span><button type="button" disabled={loading || busy || packagePage.offset + packagePage.limit >= packagePage.total} onClick={() => void load({ packageOffset: packagePage.offset + packagePage.limit }).catch(cause => { if (alive.current) setError(errorMessage(cause)); })}>下一页内容包</button></div> : null}</div><div>{selectedPackage ? <article className="studio-detail"><h3>包 v{selectedPackage.versionNumber} 快照 <PackageStatus value={selectedPackage.manifest.status} /></h3><p>SKU {selectedPackage.manifest.sku} · 固定文案 v{selectedPackage.manifest.content.content.versionNumber} · {selectedPackage.manifest.images.length} 张图片</p><DownloadLink href={packageDownloadUrl(productId, selectedPackage.id)} disabled={busy}>下载此快照 ZIP</DownloadLink></article> : <p>选择历史包查看不可变快照。</p>}</div></div>
  </section>;
}
