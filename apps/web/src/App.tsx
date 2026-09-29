import { Workbench } from "./components/Workbench.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkbench } from "./useWorkbench.js";
import { useUploads } from "./products/useUploads.js";
import { ProductList } from "./products/ProductList.js";
import { ProductDetail } from "./products/ProductDetail.js";
import { ProductForm } from "./products/ProductForm.js";
import { BatchStudio } from "./batch/BatchStudio.js";

export default function App() {
  const chat = useWorkbench();
  const uploads = useUploads();
  const [route, setRoute] = useState(() => window.location.hash || "#/products");
  const currentRoute = useRef(route), dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const navigate = useCallback((path: string) => {
    if (path === currentRoute.current) return;
    if (dirty.current && !window.confirm("有未保存的内容（商品资料、知识、文案、图片、内容包或批次），确定离开并放弃草稿？")) return;
    dirty.current = false;
    window.history.pushState(null, "", path);
    currentRoute.current = path; setRoute(path);
  }, []);
  useEffect(() => {
    const changed = () => {
      const next = window.location.hash || "#/products";
      if (next === currentRoute.current) return;
      if (dirty.current && !window.confirm("有未保存的内容（商品资料、知识、文案、图片、内容包或批次），确定离开并放弃草稿？")) {
        window.history.pushState(null, "", currentRoute.current); return;
      }
      dirty.current = false; currentRoute.current = next; setRoute(next);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("popstate", changed); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  const workbench = route === "#/workbench";
  const batchRoute = route === "#/batches";
  const productId = /^#\/products\/([a-f0-9-]{36})$/i.exec(route)?.[1];
  return <div className="products-app">
    <nav className="products-nav" aria-label="应用导航"><span className="products-brand"><b>ASA</b> 卖家工作空间</span>
      <button aria-current={!workbench && !batchRoute ? "page" : undefined} onClick={() => navigate("#/products")}>商品</button>
      <button aria-current={batchRoute ? "page" : undefined} onClick={() => navigate("#/batches")}>批量任务</button>
      <button aria-current={workbench ? "page" : undefined} onClick={() => navigate("#/workbench")}>对话工作台</button>
      <span className="products-local">本地保存</span>
    </nav>
    {/* Keep the view mounted too: its JSON editor draft survives navigation. Portals are gated by active. */}
    <section className="products-workbench" hidden={!workbench}><Workbench chat={chat} active={workbench} /></section>
    {!workbench ? <div className="products-surface">{batchRoute ? <BatchStudio onDirty={onDirty} /> : route === "#/products/new"
      ? <main className="products-page"><header className="products-page-heading"><div><p className="products-eyebrow">商品资料</p><h1>新建商品</h1><p>如实记录；没有的信息可以留空。</p></div></header>
        <ProductForm key="new" onDirty={onDirty} navigate={navigate} onCancel={() => navigate("#/products")}
          onSaved={product => navigate("#/products/" + product.product.id)} /></main>
      : productId ? <ProductDetail key={productId} productId={productId} uploads={uploads} navigate={navigate} onDirty={onDirty} />
        : route === "#/products" || route === "" ? <ProductList navigate={navigate} />
          : <main className="products-page"><h1>页面不存在</h1><button onClick={() => navigate("#/products")}>返回商品列表</button></main>}
    </div> : null}
  </div>;
}
