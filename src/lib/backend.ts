/**
 * backend.ts — HazGrid self-hosted API client (replaces Supabase entirely).
 *
 * Talks to the auth-service (FastAPI + Postgres). Two surfaces:
 *
 *  1. `api.*`      — explicit calls used by the auth/admin screens.
 *  2. `backend.*`  — a small compatibility shim shaped like the old Supabase client
 *                    (`.from(...).select().eq()...`, `.auth.getSession()`), so the
 *                    chat components keep working untouched. Only the subset the app
 *                    actually used is implemented; anything else throws loudly.
 *
 * Auth: JWT in localStorage. No self-signup — admins provision accounts.
 */
const BASE =
  (typeof localStorage !== "undefined" ? localStorage.getItem("auth_api_url") : null) ||
  (import.meta.env.VITE_AUTH_API_URL as string | undefined) ||
  "http://localhost:8050";

const TOKEN_KEY = "hazgrid_token";

export type AuthUser = {
  id: string;
  email: string;
  role: "admin" | "user";
  display_name: string | null;
  must_change_password: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
};

export const tokenStore = {
  get: () => (typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as any)?.detail;
    throw new Error(typeof detail === "string" ? detail : `HTTP ${res.status}`);
  }
  return body as T;
}

// ------------------------------------------------------------------ explicit API
export const api = {
  baseUrl: BASE,

  async login(email: string, password: string) {
    const r = await request<{ access_token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    tokenStore.set(r.access_token);
    return r.user;
  },

  logout() {
    tokenStore.clear();
  },

  async me(): Promise<AuthUser | null> {
    if (!tokenStore.get()) return null;
    try {
      return await request<AuthUser>("/auth/me");
    } catch {
      tokenStore.clear(); // expired / revoked
      return null;
    }
  },

  async changePassword(current_password: string, new_password: string) {
    const r = await request<{ access_token: string; user: AuthUser }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    });
    tokenStore.set(r.access_token);
    return r.user;
  },

  // ---- admin ----
  async listUsers() {
    const r = await request<{ users: (AuthUser & { conversation_count: number; message_count: number })[] }>(
      "/admin/users",
    );
    return r.users;
  },
  createUser(email: string, password: string, role: "admin" | "user", display_name?: string) {
    return request<AuthUser>("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, role, display_name: display_name || null }),
    });
  },
  resetPassword(userId: string, new_password: string) {
    return request<AuthUser>(`/admin/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ new_password }),
    });
  },
  setRole(userId: string, role: "admin" | "user") {
    return request<AuthUser>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  },
  deleteUser(userId: string) {
    return request<void>(`/admin/users/${userId}`, { method: "DELETE" });
  },
};

// -------------------------------------------------- Supabase-shaped compat shim
// Only the query shapes the app actually used are supported. Each builder is a
// thenable that resolves to { data, error } like the old client did.
type Result<T> = { data: T; error: Error | null };

class Builder<T = any> implements PromiseLike<Result<T>> {
  private filters: Record<string, any> = {};
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private single = false;

  constructor(
    private table: string,
    private op: "select" | "insert" | "update" | "delete",
    private payload?: any,
  ) {}

  select(_cols?: string) {
    if (this.op !== "select" && this.op !== "insert") this.op = "select";
    return this;
  }
  eq(col: string, val: any) {
    this.filters[col] = val;
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  // `.single()` behaves the same here (callers only read `.data`)
  singleRow() {
    this.single = true;
    return this;
  }

  private async run(): Promise<Result<any>> {
    const { table, op, payload, filters } = this;
    try {
      // ---------------- conversations ----------------
      if (table === "conversations") {
        if (op === "insert") {
          const r = await request<{ id: string; title: string }>("/conversations", {
            method: "POST",
            body: JSON.stringify({
              title: payload?.title,
              conversation_type: payload?.conversation_type || "general",
            }),
          });
          return { data: this.single ? r : [r], error: null };
        }
        if (op === "update") {
          const id = filters.id;
          // an updated_at-only touch is handled server-side; skip the round trip
          const keys = Object.keys(payload || {});
          if (id && !(keys.length === 1 && keys[0] === "updated_at")) {
            await request(`/conversations/${id}`, {
              method: "PATCH",
              body: JSON.stringify({
                ...(payload.title !== undefined ? { title: payload.title } : {}),
                ...(payload.insurance_settings !== undefined
                  ? { insurance_settings: payload.insurance_settings }
                  : {}),
              }),
            });
          }
          return { data: null, error: null };
        }
        if (op === "delete") {
          if (filters.id) await request(`/conversations/${filters.id}`, { method: "DELETE" });
          return { data: null, error: null };
        }
        // select
        const params = new URLSearchParams();
        if (filters.conversation_type) params.set("type", filters.conversation_type);
        if (this.limitN) params.set("limit", String(this.limitN));
        const r = await request<{ conversations: any[] }>(`/conversations?${params}`);
        let rows = r.conversations;
        if (filters.id) rows = rows.filter((c) => c.id === filters.id);
        if (this.orderCol === "updated_at" && this.orderAsc) rows = [...rows].reverse();
        return { data: this.single ? rows[0] ?? null : rows, error: null };
      }

      // ------------------- messages -------------------
      if (table === "messages") {
        if (op === "insert") {
          const rowsIn = Array.isArray(payload) ? payload : [payload];
          const out: any[] = [];
          for (const row of rowsIn) {
            out.push(
              await request(`/conversations/${row.conversation_id}/messages`, {
                method: "POST",
                body: JSON.stringify({
                  role: row.role,
                  content: row.content ?? "",
                  chart_data: row.chart_data ?? null,
                }),
              }),
            );
          }
          return { data: this.single ? out[0] : out, error: null };
        }
        if (op === "update") {
          if (filters.id) {
            await request(`/messages/${filters.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                ...(payload.content !== undefined ? { content: payload.content } : {}),
                ...(payload.chart_data !== undefined ? { chart_data: payload.chart_data } : {}),
              }),
            });
          }
          return { data: null, error: null };
        }
        if (op === "delete") return { data: null, error: null };
        // select — always scoped to a conversation in this app
        const cid = filters.conversation_id;
        if (!cid) return { data: [], error: null };
        const r = await request<{ messages: any[] }>(`/conversations/${cid}/messages`);
        return { data: this.single ? r.messages[0] ?? null : r.messages, error: null };
      }

      throw new Error(`backend shim: unsupported table "${table}"`);
    } catch (e: any) {
      return { data: this.single ? null : [], error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((r: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled as any, onrejected);
  }
}

// `.single()` is a reserved-ish name on the class above; expose it properly here.
(Builder.prototype as any).single = function () {
  return (this as any).singleRow();
};

export const backend = {
  from(table: string) {
    return {
      select: (cols?: string) => new Builder(table, "select").select(cols),
      insert: (payload: any) => new Builder(table, "insert", payload),
      update: (payload: any) => new Builder(table, "update", payload),
      delete: () => new Builder(table, "delete"),
    };
  },
  auth: {
    // Components read `session.access_token`; keep that contract.
    async getSession() {
      const token = tokenStore.get();
      return { data: { session: token ? { access_token: token } : null }, error: null };
    },
  },
  functions: {
    // The old Supabase edge functions are gone. Fail soft so optional features
    // (e.g. address autocomplete) degrade instead of throwing.
    async invoke(name: string, _opts?: any) {
      console.warn(`[backend] edge function "${name}" is not available (Supabase removed)`);
      return { data: null, error: new Error(`function ${name} unavailable`) };
    },
  },
};
