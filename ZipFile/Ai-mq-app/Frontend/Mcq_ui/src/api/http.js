// Use relative URL in dev (Vite proxies /api to backend); override with VITE_API_URL in .env for production
const API_BASE = import.meta.env.VITE_API_URL || "";

let onUnauthorized = () => {};
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

function getHeaders() {
  const token = typeof window !== "undefined" && localStorage.getItem("ai-mcq-auth")
    ? JSON.parse(localStorage.getItem("ai-mcq-auth"))?.token
    : null;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function handleResponse(response) {
  if (response.status === 401) {
    onUnauthorized();
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Session expired");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function apiPost(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}

export async function apiGet(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "GET",
    headers: getHeaders(),
  });
  return handleResponse(response);
}

export async function apiPut(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}

export async function apiDelete(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  return handleResponse(response);
}
