export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
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

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return { data: undefined as T };
  }

  const body = (await response.json().catch(() => undefined)) as
    | (Envelope<T> & { error?: ApiErrorBody })
    | undefined;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? {
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
