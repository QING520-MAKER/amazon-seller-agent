import { useEffect, useRef, useState } from "react";
import type { Page, ProductSummary } from "../../../../src/schemas.js";
import { errorMessage, listProducts } from "./api.js";
import { MissingFields, formatTime } from "./shared.js";

export function ProductList({ navigate }: { navigate: (path: string) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Page<ProductSummary>>();
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), seq = ++sequence.current;
    setData(undefined); setError("");
    void listProducts(query, offset, controller.signal).then(result => {
      if (!controller.signal.aborted && seq === sequence.current) setData(result);
    }).catch(error => { if (!controller.signal.aborted && seq === sequence.current) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [query, offset, reload]);
  return <main className="products-page">
    <header className="products-page-heading"><div><p className="products-eyebrow">本地工作空间</p><h1>商品资料</h1><p>保存真实资料与原图，为后续内容制作保留依据。</p></div>
      <button className="products-primary" onClick={() => navigate("#/products/new")}>新建商品</button></header>
    <form className="products-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setOffset(0); setReload(v => v + 1); }}>
      <label htmlFor="product-search">搜索商品</label><input id="product-search" value={search} maxLength={200} onChange={e => setSearch(e.target.value)} placeholder="按名称或 SKU 搜索" />
      <button type="submit">搜索</button>
    </form>
    {error ? <div className="products-error" role="alert">{error} <button onClick={() => setReload(v => v + 1)}>重新加载</button></div>
      : !data ? <p role="status">正在读取商品…</p>
      : !data.items.length ? <div className="products-empty"><h2>{query ? "没有匹配的商品" : "还没有保存商品"}</h2><p>{query ? "试试其他名称或 SKU。" : "从 SKU 和名称开始，其他资料可以稍后补充。"}</p></div>
      : <div className="products-table-wrap"><table className="products-table"><thead><tr><th>名称 / SKU</th><th>资料版本</th><th>当前原图</th><th>待补充项</th><th>最近更新</th></tr></thead>
        <tbody>{data.items.map(item => <tr key={item.product.id}><td><button className="products-link" onClick={() => navigate("#/products/" + item.product.id)}>{item.name}</button><span className="products-sku">{item.product.sku}</span></td>
          <td>v{item.revisionNumber}</td><td>{item.originalAssetCount} 张</td><td><MissingFields fields={item.missingFields} /></td><td>{formatTime(item.product.updatedAt)}</td></tr>)}</tbody></table></div>}
    {data && data.total > 0 ? <div className="products-pagination"><span>共 {data.total} 件 · 第 {Math.floor(offset / 20) + 1} 页</span>
      <button disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 20))}>上一页</button>
      <button disabled={offset + 20 >= data.total} onClick={() => setOffset(v => v + 20)}>下一页</button></div> : null}
  </main>;
}
