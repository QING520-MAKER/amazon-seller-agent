import {
  ListingResultSchema,
  ResearchReportSchema,
  type ListingResult,
  type ResearchReport,
} from "../../../src/schemas.js";
import type { WorkbenchRequest } from "./intent.js";

function serverMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object" && "message" in data.error && typeof data.error.message === "string") {
    return data.error.message;
  }
  return undefined;
}

async function readResponse(response: Response): Promise<unknown> {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error(`API 返回了无法解析的 JSON（HTTP ${response.status}）。请检查本地 API 服务。`);
  }
  if (!response.ok) {
    throw new Error(serverMessage(result) ?? `请求失败（HTTP ${response.status}）。请稍后重试。`);
  }
  return result;
}

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("无法连接本地 API。请运行 npm run dev:ui，并确认 8787 端口可用。");
  }
  return readResponse(response);
}

/** The browser talks exclusively to the local API; the existing graph owns all business work. */
export async function executeRequest(
  request: WorkbenchRequest,
  signal?: AbortSignal,
): Promise<ResearchReport | ListingResult> {
  const result = await apiFetch(`/api/${request.kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.payload),
    signal,
  });
  const parsed = request.kind === "research"
    ? ResearchReportSchema.safeParse(result)
    : ListingResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("API 结果未通过现有 Zod 契约校验。请查看服务端日志。");
  }
  return parsed.data;
}

export async function checkHealth(): Promise<{ status: string }> {
  const result = await apiFetch("/api/health");
  if (!result || typeof result !== "object" || !("status" in result) || typeof result.status !== "string") {
    throw new Error("API 健康检查返回了无效结果。");
  }
  return { status: result.status };
}
