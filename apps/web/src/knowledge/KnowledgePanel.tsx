import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateKnowledgeSchema,
  KnowledgeFieldsSchema,
  type KnowledgeFields,
  type KnowledgeRevision,
  type ProductDetail,
} from "../../../../src/schemas.js";
import { CatalogApiError, errorMessage } from "../products/api.js";
import { formatTime } from "../products/shared.js";
import {
  createKnowledge,
  listKnowledge,
  listKnowledgeRevisions,
  randomRequestId,
  saveKnowledge,
} from "./api.js";

type KnowledgePage = ReturnType<typeof listKnowledge> extends Promise<infer T> ? T : never;
type HistoryPage = ReturnType<typeof listKnowledgeRevisions> extends Promise<infer T> ? T : never;

const blankKnowledge = (): KnowledgeFields => ({ kind: "product_fact", title: "", content: "", source: "", status: "draft" });
const kindLabels: Record<KnowledgeFields["kind"], string> = {
  product_fact: "商品事实", brand: "品牌资料", platform_rule: "平台规则", reference: "参考资料",
};
const statusLabels: Record<KnowledgeFields["status"], string> = { draft: "草稿", approved: "已确认", archived: "已归档" };
const maxImportBytes = 200 * 1024;
const titleForFile = (name: string) => name.replace(/\.(?:md|txt)$/i, "").trim() || "导入资料";
const revisionFields = (revision: KnowledgeRevision): KnowledgeFields => ({
  kind: revision.kind, title: revision.title, content: revision.content, source: revision.source, status: revision.status,
});

const knowledgeFieldLabels: Record<string, string> = {
  kind: "分类", title: "标题", content: "正文", source: "来源", status: "状态",
};
const knowledgeFieldLimits: Record<string, string> = {
  title: "200 个字符", content: "50,000 个字符", source: "2,000 个字符",
};

function knowledgeIssueMessage(issue: { path: (string | number)[]; code: string }) {
  const field = typeof issue.path[0] === "string" ? issue.path[0] : "knowledge";
  const label = knowledgeFieldLabels[field] ?? "知识";
  if (issue.code === "too_small" || issue.code === "invalid_type") return `${label}不能为空`;
  if (issue.code === "too_big") return `${label}不能超过 ${knowledgeFieldLimits[field] ?? "允许长度"}`;
  if (issue.code === "invalid_enum_value") return `${label}不合法`;
  return `${label}格式不正确`;
}

function knowledgeValidationMessages(error: { issues: { path: (string | number)[]; code: string }[] }) {
  return [...new Set(error.issues.map(knowledgeIssueMessage))];
}

function fieldErrors(value: KnowledgeFields) {
  const parsed = KnowledgeFieldsSchema.safeParse(value);
  return parsed.success ? [] : knowledgeValidationMessages(parsed.error);
}

export function KnowledgePanel({ product, selectedRevisionIds, onSelectionChange, onDirty, disabled = false }: {
  product: ProductDetail;
  selectedRevisionIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onDirty?: (dirty: boolean) => void;
  disabled?: boolean;
}) {
  const [page, setPage] = useState<KnowledgePage>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "approved" | "archived">("all");
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState<KnowledgeFields>(blankKnowledge);
  const [baseline, setBaseline] = useState(() => JSON.stringify(blankKnowledge()));
  const [editing, setEditing] = useState<KnowledgeRevision>();
  const [history, setHistory] = useState<HistoryPage>();
  const [historyEntry, setHistoryEntry] = useState("");
  const [historyRevision, setHistoryRevision] = useState<KnowledgeRevision>();
  const [busy, setBusy] = useState<"loading" | "saving" | "importing" | undefined>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingCreate, setPendingCreate] = useState<{ requestId: string; input: string }>();
  const sequence = useRef(0);
  const loadController = useRef<AbortController | undefined>(undefined);
  const seenEntryRevisions = useRef(new Map<string, string>());
  const alive = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const historySequence = useRef(0);
  const dirty = JSON.stringify(form) !== baseline;
  useEffect(() => { onDirty?.(dirty); return () => { onDirty?.(false); }; }, [dirty, onDirty]);
  const mayDiscard = () => !dirty || window.confirm("放弃尚未保存的知识草稿？");

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (nextOffset = 0): Promise<boolean> => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const token = ++sequence.current;
    setBusy("loading"); setError("");
    try {
      const result = await listKnowledge(product.product.id, query, status, nextOffset, 20, controller.signal);
      if (!alive.current || controller.signal.aborted || token !== sequence.current) return false;
      setPage(result); setOffset(nextOffset);
      const replaced = new Map<string, KnowledgeRevision>();
      const nonApproved = new Set<string>();
      for (const item of result.items) {
        const previousRevisionId = seenEntryRevisions.current.get(item.entryId);
        if (previousRevisionId && previousRevisionId !== item.id) replaced.set(previousRevisionId, item);
        if (item.status !== "approved") nonApproved.add(item.id);
        seenEntryRevisions.current.set(item.entryId, item.id);
      }
      const nextSelectedRevisionIds = selectedRevisionIds.flatMap(id => {
        const replacement = replaced.get(id);
        // A newer approved revision may contain different facts. Require a fresh
        // explicit selection rather than silently changing generation evidence.
        if (replacement) return [];
        return nonApproved.has(id) ? [] : [id];
      });
      if (nextSelectedRevisionIds.length !== selectedRevisionIds.length || nextSelectedRevisionIds.some((id, index) => id !== selectedRevisionIds[index])) {
        onSelectionChange([...new Set(nextSelectedRevisionIds)]);
        setNotice(current => `${current ? current + " " : ""}部分已选知识已变化，已取消旧版本选择；请核对后重新勾选。`);
      }
      return true;
    } catch (loadError) {
      if (alive.current && !controller.signal.aborted && token === sequence.current) setError(errorMessage(loadError));
      return false;
    }
    finally { if (alive.current && token === sequence.current) setBusy(undefined); }
  }, [onSelectionChange, product.product.id, query, selectedRevisionIds, status]);

  useEffect(() => { seenEntryRevisions.current.clear(); }, [product.product.id]);
  useEffect(() => { void load(0); return () => { sequence.current += 1; loadController.current?.abort(); }; }, [load]);

  function startNew() {
    if (disabled || busy || !mayDiscard()) return;
    setEditing(undefined); setPendingCreate(undefined); setForm(blankKnowledge()); setHistory(undefined); setHistoryEntry(""); setError(""); setNotice("");
    setBaseline(JSON.stringify(blankKnowledge()));
  }

  function startEdit(entry: KnowledgeRevision) {
    if (disabled || busy || !mayDiscard()) return;
    const nextForm: KnowledgeFields = { kind: entry.kind, title: entry.title, content: entry.content, source: entry.source, status: "draft" };
    setEditing(entry); setPendingCreate(undefined); setForm(nextForm); setError(""); setNotice("编辑会产生新的知识版本，并回到草稿状态。");
    setBaseline(JSON.stringify(nextForm));
  }

  function toggleSelection(entry: KnowledgeRevision, checked: boolean) {
    if (entry.status !== "approved" || disabled) return;
    if (checked && selectedRevisionIds.length >= 20) { setError("一次最多选择 20 条知识。"); return; }
    const next = checked ? [...selectedRevisionIds, entry.id] : selectedRevisionIds.filter(id => id !== entry.id);
    onSelectionChange([...new Set(next)]);
  }

  async function save() {
    if (busy || disabled) return;
    const parsed = editing
      ? KnowledgeFieldsSchema.safeParse({ ...form, status: form.status })
      : CreateKnowledgeSchema.safeParse(form);
    if (!parsed.success) { setError(knowledgeValidationMessages(parsed.error).join("；")); return; }
    setBusy("saving"); setError(""); setNotice("");
    const creating = !editing;
    const inputSnapshot = JSON.stringify(parsed.data);
    const requestId = creating
      ? pendingCreate?.input === inputSnapshot ? pendingCreate.requestId : randomRequestId()
      : undefined;
    if (creating && requestId) setPendingCreate({ requestId, input: inputSnapshot });
    try {
      const saved = editing
        ? await saveKnowledge(product.product.id, editing.entryId, { ...parsed.data, baseRevisionId: editing.id })
        : await createKnowledge(product.product.id, parsed.data, requestId);
      if (!alive.current) return;
      if (creating) setPendingCreate(undefined);
      setNotice(`已保存知识版本 v${saved.revisionNumber}；当前状态：${statusLabels[saved.status]}。`);
      setEditing(saved); setForm(revisionFields(saved));
      setBaseline(JSON.stringify(revisionFields(saved)));
      if (editing && selectedRevisionIds.includes(editing.id)) onSelectionChange([
        ...selectedRevisionIds.filter(id => id !== editing.id), ...(saved.status === "approved" ? [saved.id] : []),
      ]);
      const refreshed = await load(0);
      if (creating && !refreshed) {
        setError("知识已保存，但列表刷新失败；请重试读取核对，勿重复保存。请勿再次新建相同知识。" );
        setNotice(`服务器已确认本次新增 v${saved.revisionNumber}；输入未改时重试会复用同一请求记录。`);
      }
    } catch (saveError) {
      if (alive.current) {
        setError(errorMessage(saveError));
        if (saveError instanceof CatalogApiError && saveError.status === 409) setNotice("知识库版本已变化，当前编辑仍保留；请重新读取后再决定是否覆盖。");
        else if (creating) setNotice("本次新增结果待确认；输入未改时重试会复用同一请求 ID，修改输入后才会创建新请求。");
      }
    } finally { if (alive.current) setBusy(undefined); }
  }

  async function changeStatus(entry: KnowledgeRevision, nextStatus: KnowledgeFields["status"]) {
    if (busy || disabled) return;
    const editingSameEntry = editing?.entryId === entry.entryId;
    const editorWasDirty = editingSameEntry && dirty;
    setBusy("saving"); setError(""); setNotice("");
    try {
      const saved = await saveKnowledge(product.product.id, entry.entryId, {
        kind: entry.kind, title: entry.title, content: entry.content, source: entry.source,
        status: nextStatus, baseRevisionId: entry.id,
      });
      if (!alive.current) return;
      onSelectionChange(nextStatus === "approved" ? selectedRevisionIds : selectedRevisionIds.filter(id => id !== entry.id));
      setNotice(`已将“${entry.title}”保存为${statusLabels[saved.status]} v${saved.revisionNumber}。`);
      if (editingSameEntry && !editorWasDirty) {
        const nextForm = revisionFields(saved);
        setEditing(saved); setForm(nextForm); setBaseline(JSON.stringify(nextForm));
      } else if (editingSameEntry) {
        setNotice(`已将“${entry.title}”保存为${statusLabels[saved.status]} v${saved.revisionNumber}；当前编辑草稿仍基于 v${editing?.revisionNumber ?? entry.revisionNumber}，已保留，请先重新读取后再决定是否覆盖。`);
      }
      const refreshed = await load(0);
      if (!refreshed) setNotice(current => `${current} 列表刷新失败，请点击“重试读取知识”核对。`);
    } catch (statusError) { if (alive.current) setError(errorMessage(statusError)); }
    finally { if (alive.current) setBusy(undefined); }
  }

  async function importFile(file: File) {
    if (busy || disabled || !mayDiscard()) return;
    setBusy("importing"); setError(""); setNotice("");
    try {
      if (file.size > maxImportBytes) throw new Error("导入文件超过 200 KiB 上限。");
      if (!/\.(txt|md)$/i.test(file.name)) throw new Error("仅支持 UTF-8 编码的 .txt 或 .md 文件。");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > maxImportBytes) throw new Error("导入文件超过 200 KiB 上限。");
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error("文件不是有效的 UTF-8 文本，请另存为 UTF-8 后导入。"); }
      if (content.length > 50000) throw new Error("导入正文超过 50,000 字符上限。");
      if (!alive.current) return;
      setEditing(undefined); setPendingCreate(undefined); setForm({ kind: "reference", title: titleForFile(file.name), content, source: file.name, status: "draft" });
      setBaseline(JSON.stringify(blankKnowledge()));
      setNotice("文件正文已解析到草稿，请人工检查标题、分类、来源后保存；不会自动确认。");
    } catch (importError) { if (alive.current) setError(errorMessage(importError)); }
    finally { if (alive.current) setBusy(undefined); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function viewHistory(entry: KnowledgeRevision) {
    const token = ++historySequence.current;
    if (historyEntry === entry.entryId) { setHistory(undefined); setHistoryEntry(""); setHistoryRevision(undefined); return; }
    setHistoryEntry(entry.entryId); setHistory(undefined); setHistoryRevision(undefined); setError("");
    try {
      const result = await listKnowledgeRevisions(product.product.id, entry.entryId, 0, 100);
      if (alive.current && token === historySequence.current) setHistory(result);
    }
    catch (historyError) { if (alive.current) setError(errorMessage(historyError)); }
  }

  const formIssues = useMemo(() => dirty ? fieldErrors(form) : [], [dirty, form]);
  return <section className="products-card knowledge-panel" aria-labelledby="knowledge-heading">
    <div className="products-section-heading"><div><p className="products-eyebrow">商品知识库 · 仅本商品</p><h2 id="knowledge-heading">事实与参考资料</h2><p>每条知识都保留来源；只有已确认版本可以被文案生成选择。</p></div><div className="products-actions"><button type="button" disabled={disabled || Boolean(busy)} onClick={startNew}>新建知识</button><button type="button" disabled={disabled || Boolean(busy)} onClick={() => fileInput.current?.click()}>导入 .txt / .md</button><input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></div></div>
    <div className="knowledge-toolbar"><label>搜索<input aria-label="搜索知识" value={query} disabled={Boolean(busy)} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void load(0); }} /></label><label>状态<select aria-label="知识状态" value={status} disabled={Boolean(busy)} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="all">全部</option><option value="draft">草稿</option><option value="approved">已确认</option><option value="archived">已归档</option></select></label><button type="button" disabled={Boolean(busy)} onClick={() => void load(0)}>搜索</button></div>
    {error ? <div className="products-error" role="alert">{error}<button type="button" onClick={() => void load(offset)}>重试读取知识</button></div> : null}
    {notice ? <p className="content-notice" role="status">{notice}</p> : null}
    {page?.items.length ? <div className="knowledge-list">{page.items.map(entry => { const selected = selectedRevisionIds.includes(entry.id); return <article className={`knowledge-entry knowledge-${entry.status}`} key={entry.entryId + entry.id}>
      <div className="knowledge-entry-heading"><div><h3>{entry.title}</h3><span className="knowledge-badge">{kindLabels[entry.kind]} · {statusLabels[entry.status]} · v{entry.revisionNumber}</span></div><label className="knowledge-select">{entry.status === "approved" ? <><input type="checkbox" aria-label={`选择知识 ${entry.title}`} checked={selected} disabled={disabled || Boolean(busy)} onChange={event => toggleSelection(entry, event.target.checked)} />用于文案</> : <small>草稿不能用于文案</small>}</label></div>
      <p className="knowledge-source">来源：{entry.source} · {formatTime(entry.createdAt)}</p><pre>{entry.content}</pre>
      <div className="products-actions"><button type="button" disabled={disabled || Boolean(busy)} onClick={() => startEdit(entry)}>编辑并回到草稿</button>{entry.status === "draft" ? <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void changeStatus(entry, "approved")}>确认知识</button> : entry.status === "approved" ? <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void changeStatus(entry, "archived")}>归档知识</button> : null}<button type="button" disabled={Boolean(busy)} onClick={() => void viewHistory(entry)}>{historyEntry === entry.entryId ? "关闭历史" : "查看历史"}</button></div>
      {historyEntry === entry.entryId && history ? <div className="knowledge-history"><h4>历史版本（只读快照）</h4>{history.items.map(revision => <button type="button" key={revision.id} aria-pressed={historyRevision?.id === revision.id} onClick={() => setHistoryRevision(revision)}>v{revision.revisionNumber} · {statusLabels[revision.status]} · {formatTime(revision.createdAt)}</button>)}{historyRevision ? <div className="knowledge-history-snapshot"><strong>v{historyRevision.revisionNumber} · {statusLabels[historyRevision.status]}</strong><p>来源：{historyRevision.source}</p><pre>{historyRevision.content}</pre></div> : null}</div> : null}
    </article>; })}</div> : page ? <p className="products-empty">没有符合筛选条件的知识条目。</p> : <p role="status">正在读取知识库…</p>}
    {page && page.total > page.limit ? <div className="products-pagination"><span>共 {page.total} 条</span><button type="button" disabled={Boolean(busy) || offset === 0} onClick={() => void load(Math.max(0, offset - page.limit))}>上一页</button><button type="button" disabled={Boolean(busy) || offset + page.limit >= page.total} onClick={() => void load(offset + page.limit)}>下一页</button></div> : null}
    <div className="knowledge-editor"><div className="products-section-heading"><h3>{editing ? `编辑知识 · v${editing.revisionNumber}` : "知识编辑器"}</h3>{editing ? <button type="button" disabled={Boolean(busy)} onClick={startNew}>清空编辑器</button> : null}</div><div className="knowledge-form-grid"><label>标题<input aria-label="知识标题" maxLength={200} disabled={Boolean(busy) || disabled} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label><label>分类<select aria-label="知识分类" disabled={Boolean(busy) || disabled} value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as KnowledgeFields["kind"] }))}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>来源<input aria-label="知识来源" maxLength={2000} disabled={Boolean(busy) || disabled} value={form.source} onChange={event => setForm(current => ({ ...current, source: event.target.value }))} /></label><label>状态<select aria-label="知识状态编辑" disabled={Boolean(busy) || disabled} value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as KnowledgeFields["status"] }))}><option value="draft">草稿</option><option value="approved">已确认</option><option value="archived">已归档</option></select></label></div><label>正文（纯文本）<span className="content-counter">{form.content.length}/50000</span><textarea aria-label="知识正文" maxLength={50000} rows={9} disabled={Boolean(busy) || disabled} value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} /></label>{formIssues.length ? <ul className="knowledge-issues">{formIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}<button type="button" className="products-primary" disabled={Boolean(busy) || disabled || formIssues.length > 0} onClick={() => void save()}>{busy === "saving" ? "正在保存…" : "保存知识版本"}</button></div>
  </section>;
}
