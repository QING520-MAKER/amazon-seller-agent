import { useEffect, useRef, useState } from "react";
import type { OriginalAsset, Page } from "../../../../src/schemas.js";
import { contentUrl, errorMessage, getAssetBlob, listAssets, setAssetState } from "./api.js";
import { formatTime } from "./shared.js";
import type { Uploads } from "./useUploads.js";

function Preview({ asset }: { asset: OriginalAsset }) {
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl(""); setError("");
    void getAssetBlob(asset.productId, asset.id, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.id, asset.productId]);
  return <div className="products-image">{error ? <p role="alert">{error}</p> : url ? <img src={url} alt={asset.originalName} /> : <span>正在读取原图…</span>}</div>;
}
export function OriginalAssets({ productId, uploads, onChanged }: { productId: string; uploads: Uploads; onChanged: () => void }) {
  const [state, setState] = useState<"active" | "archived">("active");
  const [offset, setOffset] = useState(0), [reload, setReload] = useState(0);
  const [data, setData] = useState<Page<OriginalAsset>>();
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>();
  const seq = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), token = ++seq.current;
    setData(undefined); setError("");
    void listAssets(productId, state, offset, controller.signal).then(result => {
      if (controller.signal.aborted || token !== seq.current) return;
      if (!result.items.length && offset > 0) { setOffset(0); return; }
      setData(result);
    }).catch(error => { if (!controller.signal.aborted && token === seq.current) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [productId, state, offset, reload, uploads.versions[productId]]);
  async function change(asset: OriginalAsset) {
    if (busy) return;
    if (!asset.archivedAt && !window.confirm("从当前原图库移除这张图片？原文件仍会保留，可以恢复。")) return;
    setBusy(asset.id); setNotice("");
    try {
      await setAssetState(productId, asset, !asset.archivedAt);
      if (!alive.current) return;
      setReload(v => v + 1); onChanged();
    } catch (error) {
      if (!alive.current) return;
      setNotice(errorMessage(error)); setReload(v => v + 1);
    } finally { if (alive.current) setBusy(undefined); }
  }
  const queue = uploads.items.filter(item => item.productId === productId);
  return <section className="products-assets">
    <div className="products-section-heading"><div><h2>当前原图库</h2><p>原文件保持不变；历史资料版本不固定此图片集合。</p></div>
      <label className="products-upload">上传原图<input aria-label="上传原图" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple onChange={event => {
        uploads.add(productId, Array.from(event.target.files ?? [])); event.target.value = "";
      }} /></label></div>
    <p className="products-note">JPEG / PNG · 单张 ≤ 20 MiB · 最多 4000 万像素、单边 ≤ 12000 像素。EXIF 信息原样保留。</p>
    {queue.length ? <ul className="products-upload-status" aria-label="上传状态">{queue.map(item => <li key={item.id}>
      <strong>{item.file.name}</strong><span role="status">{item.message}</span>
      {item.state === "error" || item.state === "uncertain" ? <button onClick={() => uploads.retry(item.id)}>{item.state === "uncertain" ? "重新核对 / 重试" : "重试这一张"}</button> : null}
      {item.state === "uploading" ? <button onClick={uploads.stopWaiting}>停止等待</button> : null}
    </li>)}</ul> : null}
    <div className="products-actions"><button aria-pressed={state === "active"} onClick={() => { setState("active"); setOffset(0); }}>当前原图</button>
      <button aria-pressed={state === "archived"} onClick={() => { setState("archived"); setOffset(0); }}>已移除</button>
      <button onClick={() => setReload(v => v + 1)}>刷新原图库</button></div>
    {notice ? <p className="products-error" role="alert">{notice}</p> : null}
    {error ? <div className="products-error" role="alert">{error}<button onClick={() => setReload(v => v + 1)}>重新读取原图</button></div>
      : !data ? <p role="status">正在读取原图库…</p>
      : !data.items.length ? <p className="products-empty">{state === "active" ? "尚未上传原图。" : "没有已移除的原图。"}</p>
      : <div className="products-asset-grid">{data.items.map(asset => <article className="products-asset-card" key={asset.id}>
        <Preview asset={asset} /><div className="products-asset-meta"><h3>{asset.originalName}</h3>
          <p>{asset.width} × {asset.height} 原始像素 · {(asset.sizeBytes / 1024).toFixed(1)} KiB</p>
          <p>{formatTime(asset.createdAt)}{asset.orientation ? " · EXIF 方向 " + asset.orientation : ""}</p>
          <div className="products-actions"><a href={contentUrl(productId, asset.id)} target="_blank" rel="noreferrer">预览原图</a>
            <a href={contentUrl(productId, asset.id, true)}>下载原文件</a>
            <button disabled={Boolean(busy)} onClick={() => void change(asset)}>{busy === asset.id ? "处理中…" : asset.archivedAt ? "恢复" : "移除"}</button></div>
        </div></article>)}</div>}
    {data && data.total > 20 ? <div className="products-pagination"><span>共 {data.total} 张</span>
      <button disabled={!offset} onClick={() => setOffset(v => v - 20)}>上一页原图</button>
      <button disabled={offset + 20 >= data.total} onClick={() => setOffset(v => v + 20)}>下一页原图</button></div> : null}
  </section>;
}
