import { errorEnvelopeSchema, type ErrorEnvelope } from "@kakeai/contracts";

export type ApiErrorBody = ErrorEnvelope["error"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorBody["code"];
  readonly requestId: string;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
    this.details = body.details;
  }
}

export interface Envelope<T> {
  data: T;
  meta?: unknown;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
}

const API_BASE_PATH = "/api/v1";

function buildApiUrl(path: string): string {
  return `${API_BASE_PATH}${path}`;
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  if (response.status === 204) {
    return { data: undefined as T };
  }

  const body = (await response.json().catch(() => undefined)) as
    | (Envelope<T> & { error?: ApiErrorBody })
    | undefined;

  if (!response.ok) {
    const parsedError = errorEnvelopeSchema.safeParse(body);
    throw new ApiError(
      response.status,
      parsedError.success
        ? parsedError.data.error
        : {
            code: "INTERNAL_ERROR",
            message: "サーバーと通信できませんでした。",
            requestId: "",
          },
    );
  }

  if (body === undefined || body.data === undefined) {
    throw new ApiError(response.status, {
      code: "INTERNAL_ERROR",
      message: "サーバーの応答を解釈できませんでした。",
      requestId: "",
    });
  }

  return body;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const response = await fetch(buildApiUrl(path), {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return parseEnvelope<T>(response);
}

export async function apiUpload<T>(path: string, file: File): Promise<Envelope<T>> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(buildApiUrl(path), { method: "POST", body: form });
  return parseEnvelope<T>(response);
}

export function renderContentUrl(assetId: string): string {
  return buildApiUrl(`/assets/${encodeURIComponent(assetId)}/render-content`);
}
