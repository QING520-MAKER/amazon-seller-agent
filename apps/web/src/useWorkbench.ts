import { useEffect, useRef, useState } from "react";
import type { ListingResult, ResearchReport } from "../../../src/schemas.js";
import { executeRequest } from "./api.js";
import { parseIntent, REQUEST_LABELS, type WorkbenchRequest } from "./intent.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  state?: "pending" | "success" | "error" | "choose";
  request?: WorkbenchRequest;
  result?: ResearchReport | ListingResult;
}

interface Conversation {
  id: string;
  title: string;
  marketplace: string;
  draft: string;
  messages: ChatMessage[];
  lastRequest?: WorkbenchRequest;
}

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "新会话", marketplace: "us", draft: "", messages: [] };
}

function requestTitle(request: WorkbenchRequest) {
  const subject = "keyword" in request.payload ? request.payload.keyword
    : "product" in request.payload && request.payload.product ? request.payload.product.name
      : "listing" in request.payload ? request.payload.listing.title || "未命名 Listing" : "Listing";
  return `${REQUEST_LABELS[request.kind]} · ${subject}`;
}

export function useWorkbench() {
  const [workspace, setWorkspace] = useState(() => {
    const first = newConversation();
    return { activeId: first.id, conversations: [first] };
  });
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
  }, []);

  const active = workspace.conversations.find((item) => item.id === workspace.activeId)!;
  const busy = active.messages.some((item) => item.state === "pending");
  const update = (id: string, change: (item: Conversation) => Conversation) => setWorkspace((current) => ({
    ...current,
    conversations: current.conversations.map((item) => item.id === id ? change(item) : item),
  }));

  function setActive(id: string) {
    setWorkspace((current) => ({ ...current, activeId: id }));
  }
  function createConversation() {
    const item = newConversation();
    setWorkspace((current) => ({ activeId: item.id, conversations: [item, ...current.conversations] }));
  }
  function removeConversation(id: string) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setWorkspace((current) => {
      const remaining = current.conversations.filter((item) => item.id !== id);
      if (!remaining.length) remaining.push(newConversation());
      return { activeId: current.activeId === id ? remaining[0]!.id : current.activeId, conversations: remaining };
    });
  }
  function setDraft(draft: string) { update(active.id, (item) => ({ ...item, draft })); }
  function setMarketplace(marketplace: string) {
    update(active.id, (item) => ({
      ...item, marketplace,
      lastRequest: item.lastRequest ? {
        ...item.lastRequest, payload: { ...item.lastRequest.payload, marketplace },
      } as WorkbenchRequest : undefined,
    }));
  }

  function addNotice(text: string, userText?: string, choose = false) {
    update(active.id, (item) => ({
      ...item, draft: "", messages: [...item.messages,
        ...(userText ? [{ id: crypto.randomUUID(), role: "user" as const, text: userText }] : []),
        { id: crypto.randomUUID(), role: "assistant", text, state: choose ? "choose" : "error" },
      ],
    }));
  }

  async function submitRequest(request: WorkbenchRequest, text?: string) {
    const id = active.id;
    // The ref also blocks a second click before React paints the pending state.
    if (controllers.current.has(id)) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const messageId = crypto.randomUUID();
    update(id, (item) => ({
      ...item,
      draft: "",
      marketplace: request.payload.marketplace,
      title: item.lastRequest ? item.title : requestTitle(request),
      lastRequest: request,
      messages: [...item.messages,
        { id: crypto.randomUUID(), role: "user", text: text ?? `${requestTitle(request)}（Amazon ${request.payload.marketplace.toUpperCase()}）` },
        { id: messageId, role: "assistant", state: "pending", request },
      ],
    }));
    try {
      const result = await executeRequest(request, controller.signal);
      if (controller.signal.aborted) throw new DOMException("Request aborted", "AbortError");
      update(id, (item) => ({ ...item, messages: item.messages.map((message) => message.id === messageId
        ? { ...message, state: "success", result } : message) }));
    } catch (error) {
      const text = controller.signal.aborted ? "已停止等待。服务端可能仍在完成请求，你可以继续提交新任务。"
        : error instanceof Error ? error.message : "请求未能完成，请稍后重试。";
      update(id, (item) => ({ ...item, messages: item.messages.map((message) => message.id === messageId
        ? { ...message, state: "error", text } : message) }));
    } finally {
      if (controllers.current.get(id) === controller) controllers.current.delete(id);
    }
  }

  function submitText(text: string) {
    if (!text.trim() || controllers.current.has(active.id)) return;
    try {
      const request = parseIntent(text, active.lastRequest, active.marketplace);
      if (request) void submitRequest(request, text);
      else addNotice("我目前支持以下四种任务。选择一个入口继续，也可以输入明确的任务和关键词。", text, true);
    } catch (error) {
      addNotice(error instanceof Error ? error.message : "无法解析请求，请检查输入。", text);
    }
  }
  function cancel() { controllers.current.get(active.id)?.abort(); }

  return { ...workspace, active, busy, setActive, createConversation, removeConversation,
    setDraft, setMarketplace, submitRequest, submitText, cancel, addNotice };
}
