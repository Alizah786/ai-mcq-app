import { request } from "@playwright/test";

export const API_BASE = process.env.E2E_API_URL || "http://127.0.0.1:4000";

export function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export async function apiJson(ctx, method, path, body, token) {
  const res = await ctx.fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: body ?? undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status()}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function createApiContext() {
  return request.newContext();
}
