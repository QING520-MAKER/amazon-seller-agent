import { useEffect, useRef, useState } from "react";
import { CreateProductSchema, SaveProductBriefSchema, type ProductBrief, type ProductDetail } from "../../../../src/schemas.js";
import { CatalogApiError, createProduct, errorMessage, getProduct, listProducts, saveProduct } from "./api.js";
import { RevisionFacts } from "./shared.js";

interface Draft { sku: string; brief: ProductBrief; sourceNote: string }
const blank = (): Draft => ({ sku: "", brief: { name: "", brand: "", attributes: [], features: [], audience: "", useCases: [], included: [], tone: "professional" }, sourceNote: "" });
const fromProduct = (product: ProductDetail): Draft => ({ sku: product.product.sku, brief: product.currentRevision.brief, sourceNote: product.currentRevision.sourceNote });
const labels = { attributes: "属性 / 规格", features: "卖点事实", useCases: "使用场景", included: "包装清单" } as const;

export function ProductForm({ product, onSaved, onReloaded, onCancel, onDirty, navigate }: {
  product?: ProductDetail; onSaved: (product: ProductDetail) => void; onCancel: () => void;
  onReloaded?: (product: ProductDetail) => void;
  onDirty: (dirty: boolean) => void; navigate: (path: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => product ? fromProduct(product) : blank());
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [baseRevision, setBaseRevision] = useState(product?.currentRevision.id);
  const [operation, setOperation] = useState<"saving" | "reloading" | "checking">();
  const busy = operation !== undefined;
  const [error, setError] = useState<CatalogApiError>();
  const [latest, setLatest] = useState<ProductDetail>();
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef(false), alive = useRef(true);
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onDirty(false); }; }, [onDirty]);
  function changeBrief<K extends keyof ProductBrief>(key: K, value: ProductBrief[K]) {
    setDraft(d => ({ ...d, brief: { ...d.brief, [key]: value } }));
  }
  async function submit() {
    if (lock.current) return;
    setError(undefined); setNotice(""); setChecked(false); setLatest(undefined);
    const payload = product
      ? SaveProductBriefSchema.safeParse({ baseRevisionId: baseRevision, brief: draft.brief, sourceNote: draft.sourceNote })
      : CreateProductSchema.safeParse(draft);
    if (!payload.success) {
      setError(new CatalogApiError("请检查标记的字段。", 422, "INVALID_REQUEST", undefined,
        payload.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message }))));
      return;
    }
    lock.current = true; setOperation("saving");
    try {
      let saved: ProductDetail;
      if (product) {
        const result = await saveProduct(product.product.id, SaveProductBriefSchema.parse(payload.data));
        if (!alive.current) return;
        setBaseRevision(result.revision.id);
        // A confirmed save can be safely re-read even if the subsequent detail read fails.
        try { saved = await getProduct(product.product.id); }
        catch { throw new CatalogApiError("服务器已确认保存，但详情刷新失败。请核对服务器记录，草稿仍保留。", 0, "REFRESH_FAILED", undefined, undefined, true); }
      } else {
        saved = await createProduct(CreateProductSchema.parse(payload.data));
      }
      if (!alive.current) return;
      onDirty(false);
      setBaseline(JSON.stringify(fromProduct(saved)));
      setDraft(fromProduct(saved));
      onSaved(saved);
    } catch (error) {
      if (alive.current) setError(error instanceof CatalogApiError ? error : new CatalogApiError(errorMessage(error)));
    } finally { lock.current = false; if (alive.current) setOperation(undefined); }
  }
  async function viewLatest() {
    if (lock.current) return;
    lock.current = true; setOperation("checking");
    setNotice("");
    try {
      let found: ProductDetail | undefined;
      if (product) found = await getProduct(product.product.id);
      else {
        for (let offset = 0;; offset += 20) {
          const page = await listProducts(draft.sku.trim(), offset);
          const match = page.items.find(item => item.product.sku === draft.sku.trim());
          if (match) { found = await getProduct(match.product.id); break; }
          if (offset + page.limit >= page.total) break;
        }
      }
      if (!alive.current) return;
      setLatest(found); setChecked(true);
      if (!found) setNotice("当前没有找到相同 SKU 的记录，可以重试；服务端仍会检查 SKU 唯一性。");
    } catch (error) { if (alive.current) setNotice(errorMessage(error)); }
    finally { lock.current = false; if (alive.current) setOperation(undefined); }
  }
  async function discard() {
    if (lock.current || !product) return;
    if (!window.confirm("放弃本地未保存草稿，并载入服务器最新资料？")) return;
    lock.current = true; setOperation("reloading"); setNotice("");
    try {
      const fresh = await getProduct(product.product.id);
      if (!alive.current) return;
      const value = fromProduct(fresh);
      setDraft(value); setBaseline(JSON.stringify(value)); setBaseRevision(fresh.currentRevision.id);
      setLatest(undefined); setError(undefined); setNotice(""); onDirty(false);
      onReloaded?.(fresh);
    } catch (error) { if (alive.current) setNotice(errorMessage(error)); }
    finally { lock.current = false; if (alive.current) setOperation(undefined); }
  }
  async function copyDraft() {
    try { await navigator.clipboard.writeText(JSON.stringify(draft, null, 2)); setNotice("本地草稿已复制。"); }
    catch { setNotice("无法访问剪贴板，请从下方文本框手动复制。"); }
  }
  const needsReview = error?.status === 409 || error?.uncertain;
  return <form className="products-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <fieldset disabled={busy}>
      <div className="products-form-grid">
        <label>SKU <span aria-hidden="true">*</span><input aria-label="SKU" required value={draft.sku} maxLength={128} readOnly={Boolean(product)} onChange={e => setDraft(d => ({ ...d, sku: e.target.value }))} /><small>{product ? "新建后只读" : "本地 SKU 区分大小写，例如 ABC 与 abc。"}</small></label>
        <label>商品名称 <span aria-hidden="true">*</span><input aria-label="商品名称" required value={draft.brief.name} maxLength={300} onChange={e => changeBrief("name", e.target.value)} /></label>
        <label>品牌<input aria-label="品牌" value={draft.brief.brand} maxLength={500} onChange={e => changeBrief("brand", e.target.value)} /><small>留空表示尚未记录。</small></label>
        <label>适用人群<input aria-label="适用人群" value={draft.brief.audience} maxLength={500} onChange={e => changeBrief("audience", e.target.value)} /></label>
      </div>
      <div className="products-form-grid">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <section className="products-line-editor" key={key}>
        <h3>{labels[key]}</h3>
        {draft.brief[key].map((line, index) => <div className="products-line" key={index}>
          <input aria-label={labels[key] + " " + (index + 1)} value={line} maxLength={2000} onChange={e => changeBrief(key, draft.brief[key].map((old, i) => i === index ? e.target.value : old))} />
          <button type="button" aria-label={"删除" + labels[key] + " " + (index + 1)} onClick={() => changeBrief(key, draft.brief[key].filter((_, i) => i !== index))}>移除行</button>
        </div>)}
        <button type="button" disabled={draft.brief[key].length >= 100} onClick={() => changeBrief(key, [...draft.brief[key], ""])}>添加{labels[key]}</button>
      </section>)}</div>
      <label>来源 / 待确认说明<textarea aria-label="来源 / 待确认说明" rows={4} maxLength={10000} value={draft.sourceNote} onChange={e => setDraft(d => ({ ...d, sourceNote: e.target.value }))} placeholder="记录资料来源，或哪些参数仍待核实。" /></label>
      <label className="products-tone">写作偏好<select aria-label="写作偏好" value={draft.brief.tone} onChange={e => changeBrief("tone", e.target.value as ProductBrief["tone"])}>
        <option value="professional">专业</option><option value="friendly">友好</option><option value="urgent">紧迫</option><option value="luxury">高端</option>
      </select><small>写作偏好不是商品事实，本页仅保存资料。</small></label>
    </fieldset>
    {error ? <div className="products-error" role="alert"><strong>{error.message}</strong>
      {error.issues?.length ? <ul>{error.issues.map((issue, i) => <li key={i}>{issue.path}: {issue.message}</li>)}</ul> : null}
      {error.details?.existingProductId ? <button type="button" onClick={() => navigate("#/products/" + error.details!.existingProductId)}>打开已存在商品</button> : null}
    </div> : null}
    {needsReview ? <section className="products-conflict">
      <p>草稿不会自动覆盖服务器资料。请查看最新内容后决定。</p>
      <div className="products-actions"><button type="button" disabled={busy} onClick={() => void viewLatest()}>查看最新资料</button><button type="button" onClick={() => void copyDraft()}>复制本地草稿</button>
        {product ? <button type="button" disabled={busy} onClick={() => void discard()}>放弃本地草稿并载入最新</button> : null}</div>
      <details><summary>本地草稿文本</summary><textarea aria-label="本地草稿文本" readOnly value={JSON.stringify(draft, null, 2)} rows={8} /></details>
      {latest ? <div><h3>服务器最新资料 · v{latest.currentRevision.revisionNumber}</h3><RevisionFacts revision={latest.currentRevision} />
        {!product ? <button type="button" onClick={() => navigate("#/products/" + latest.product.id)}>打开服务器记录</button> : null}</div> : null}
    </section> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {operation === "reloading" ? <p role="status">正在载入最新资料…</p> : null}
    {!product ? <p className="products-note">先保存商品，再上传原图。尚未填写的事实会保持为空。</p> : null}
    <div className="products-actions products-form-footer">
      <button className="products-primary" type="submit" disabled={busy || Boolean(error?.uncertain && !checked)}>{operation === "saving" ? "正在保存…" : operation === "reloading" ? "正在载入…" : operation === "checking" ? "正在读取…" : product ? "保存资料" : "创建商品"}</button>
      <button type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm("放弃尚未保存的商品资料？")) { onDirty(false); onCancel(); } }}>取消</button>
      <span>{dirty ? "有未保存的编辑" : "资料仅保存在本地"}</span>
    </div>
  </form>;
}
