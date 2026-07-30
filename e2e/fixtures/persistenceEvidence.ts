import type { Page } from "@playwright/test";

export type ApiPersistenceEvidence<TResponse, TRequest = unknown> = {
  method: string;
  pathname: string;
  status: number;
  requestBody: TRequest | undefined;
  responseBody: TResponse;
};

type JsonResponseOptions<TRequest> = {
  method: string;
  pathname: string;
  requestMatches?: (body: TRequest | undefined) => boolean;
  timeout?: number;
};

function requestJson<T>(postData: string | null): T | undefined {
  if (!postData) return undefined;
  try {
    return JSON.parse(postData) as T;
  } catch {
    return undefined;
  }
}

/**
 * Registers a response waiter before the UI action that causes persistence.
 * The resolved value is ordered evidence: matching request, successful server
 * acknowledgement, and parsed response body. Call this before click/goto.
 */
export async function waitForJsonApiResponse<TResponse, TRequest = unknown>(
  page: Page,
  options: JsonResponseOptions<TRequest>,
): Promise<ApiPersistenceEvidence<TResponse, TRequest>> {
  const method = options.method.toUpperCase();
  let matchedRequestBody: TRequest | undefined;
  const response = await page.waitForResponse(
    (candidate) => {
      const request = candidate.request();
      if (request.method().toUpperCase() !== method) return false;
      if (new URL(candidate.url()).pathname !== options.pathname) return false;
      const body = requestJson<TRequest>(request.postData());
      if (options.requestMatches && !options.requestMatches(body)) return false;
      matchedRequestBody = body;
      return true;
    },
    { timeout: options.timeout ?? 30_000 },
  );

  if (!response.ok()) {
    throw new Error(
      `${method} ${options.pathname} persistence failed with HTTP ${response.status()}`,
    );
  }

  return {
    method,
    pathname: options.pathname,
    status: response.status(),
    requestBody: matchedRequestBody,
    responseBody: (await response.json()) as TResponse,
  };
}
