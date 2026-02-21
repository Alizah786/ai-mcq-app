// Use relative URL in dev (Vite proxies /api to backend); override with VITE_API_URL in .env for production
const API_BASE = import.meta.env.VITE_API_URL || "";

let onUnauthorized = () => {};
let onPaymentRequired = () => {};
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}
export function setOnPaymentRequired(fn) {
  onPaymentRequired = fn;
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
    const e = new Error(error.message || "Session expired");
    e.status = 401;
    e.payload = error;
    throw e;
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 402) {
      onPaymentRequired(error);
    }
    const e = new Error(error.message || `HTTP ${response.status}`);
    e.status = response.status;
    e.payload = error;
    throw e;
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

export async function apiUpload(endpoint, formData) {
  const token = typeof window !== "undefined" && localStorage.getItem("ai-mcq-auth")
    ? JSON.parse(localStorage.getItem("ai-mcq-auth"))?.token
    : null;

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: formData,
  });
  return handleResponse(response);
}
