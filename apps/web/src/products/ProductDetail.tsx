import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductDetail as Detail, ProductRevision } from "../../../../src/schemas.js";
import { errorMessage, getProduct, getRevision, listRevisions } from "./api.js";
import { MissingFields, RevisionFacts, formatTime } from "./shared.js";
import { ProductForm } from "./ProductForm.js";
import { OriginalAssets } from "./OriginalAssets.js";
import type { Uploads } from "./useUploads.js";

function History({ product, revisionChanged }: { product: Detail; revisionChanged: string }) {
  const [items, setItems] = useState<Pick<ProductRevision, "id" | "createdAt" | "revisionNumber">[]>([]);
  const [total, setTotal] = useState(0), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ProductRevision>();
  const [revisionError, setRevisionError] = useState("");
  const request = useRef<AbortController | undefined>(undefined), detailRequest = useRef<AbortController | undefined>(undefined);
  const sequence = useRef(0);
  const load = useCallback(async (offset: number) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setError(""); setLoading(true);
    try {
      const result = await listRevisions(product.product.id, offset, controller.signal);
      if (controller.signal.aborted) return;
      setItems(previous => offset === 0 ? result.items : [...previous, ...result.items]); setTotal(result.total);
    } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [product.product.id]);
  useEffect(() => { void load(0); return () => { request.current?.abort(); detailRequest.current?.abort(); }; }, [load, revisionChanged]);
  async function view(revisionId: string) {
    detailRequest.current?.abort();
    const controller = new AbortController(), token = ++sequence.current; detailRequest.current = controller;
    setSelected(undefined); setRevisionError("正在读取历史资料…");
    try {
      const revision = await getRevision(product.product.id, revisionId, controller.signal);
      if (!controller.signal.aborted && token === sequence.current) { setSelected(revision); setRevisionError(""); }
    } catch (error) { if (!controller.signal.aborted) setRevisionError(errorMessage(error)); }
  }
  return <section className="products-history"><h2>资料版本</h2>
    {error ? <p className="products-error" role="alert">{error}<button onClick={() => void load(0)}>重试版本列表</button></p> : null}
    <div className="products-version-list">{items.map(item => <button key={item.id} onClick={() => void view(item.id)}>
      <strong>v{item.revisionNumber}{item.id === product.currentRevision.id ? " · 当前" : ""}</strong><small>{formatTime(item.createdAt)}</small></button>)}</div>
    {loading ? <p role="status">正在读取版本…</p> : null}
    {items.length < total ? <button disabled={loading} onClick={() => void load(items.length)}>更多历史版本</button> : null}
    {revisionError ? <p role="status">{revisionError}</p> : null}
    {selected ? <div className="products-history-snapshot"><div className="products-section-heading"><h3>历史资料 · v{selected.revisionNumber} · 只读</h3><button onClick={() => setSelected(undefined)}>关闭历史资料</button></div>
      <p>仅查看资料快照；下方为当前原图库。</p><RevisionFacts revision={selected} /></div> : null}
  </section>;
}

export function ProductDetail({ productId, uploads, navigate, onDirty }: {
  productId: string; uploads: Uploads; navigate: (path: string) => void; onDirty: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<Detail>(), [error, setError] = useState(""), [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const acceptDetail = useCallback((result: Detail) => {
    // A saved/reloaded snapshot supersedes any background read already in flight.
    ++seq.current;
    request.current?.abort();
    setError(""); setData(result);
  }, []);
  const changed = useCallback(() => setReload(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController(), token = ++seq.current;
    request.current = controller;
    setError("");
    void getProduct(productId, controller.signal).then(result => {
      if (!controller.signal.aborted && seq.current === token) acceptDetail(result);
    }).catch(error => { if (!controller.signal.aborted && seq.current === token) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [productId, reload, uploads.versions[productId], acceptDetail]);
  return <main className="products-page">
    <button className="products-back" onClick={() => navigate("#/products")}>← 商品列表</button>
    {error ? <p className="products-error" role="alert">{error}<button onClick={changed}>重新加载详情</button></p> : null}
    {!data ? !error && <p role="status">正在读取商品…</p> : <>
      <header className="products-page-heading"><div><p className="products-eyebrow">SKU · {data.product.sku}</p><h1>{data.currentRevision.brief.name}</h1>
        <p>资料 v{data.currentRevision.revisionNumber} · 最近更新 {formatTime(data.product.updatedAt)}</p></div>
        {!editing ? <button className="products-primary" onClick={() => setEditing(true)}>编辑资料</button> : null}</header>
      <div className="products-info"><MissingFields fields={data.missingFields} /><p>保存不代表事实已核验或审核通过。</p></div>
      {editing ? <ProductForm product={data} onDirty={onDirty} navigate={navigate} onCancel={() => setEditing(false)}
        onReloaded={acceptDetail} onSaved={result => { acceptDetail(result); setEditing(false); }} /> : <section className="products-card"><h2>当前资料</h2><RevisionFacts revision={data.currentRevision} /></section>}
      <History product={data} revisionChanged={data.currentRevision.id} />
      <OriginalAssets productId={productId} uploads={uploads} onChanged={changed} />
    </>}
  </main>;
}
