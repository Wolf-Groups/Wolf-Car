import { todo } from '../shop/todo';

/**
 * Minimal read-only client for Odoo's JSON-RPC endpoint. The only file that
 * knows Odoo's wire format; everything else works with plain rows.
 */
export interface OdooConfig {
  /** Base address without a trailing slash, e.g. https://erp-test.wolf-groups.com */
  url: string;
  db: string;
  login: string;
  apiKey: string;
}

export class OdooError extends Error {}

const ENV_KEYS = ['ODOO_URL', 'ODOO_DB', 'ODOO_LOGIN', 'ODOO_API_KEY'] as const;

export function odooConfigFromEnv(env: Record<string, string | undefined>): OdooConfig {
  const value = (key: (typeof ENV_KEYS)[number]) => (env[key] ?? '').trim();
  const missing = ENV_KEYS.filter((key) => !value(key));
  if (missing.length) throw new OdooError(`Missing Odoo settings in api/.env: ${missing.join(', ')}`);
  return {
    url: value('ODOO_URL').replace(/\/+$/, ''),
    db: value('ODOO_DB'),
    login: value('ODOO_LOGIN'),
    apiKey: value('ODOO_API_KEY'),
  };
}

interface RpcReply<T> {
  result?: T;
  error?: { message?: string; data?: { message?: string } };
}

export class OdooClient {
  private uid: number | undefined;

  constructor(
    private readonly cfg: OdooConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  searchRead<T>(model: string, domain: unknown[], fields: readonly string[], context?: Record<string, unknown>): Promise<T[]> {
    return this.execute<T[]>(model, 'search_read', [domain], { fields: [...fields], ...(context ? { context } : {}) });
  }

  read<T>(model: string, ids: number[], fields: readonly string[]): Promise<T[]> {
    return this.execute<T[]>(model, 'read', [ids], { fields: [...fields] });
  }

  /** Creates one record (execute_kw `create` with [[values]]) and answers its id. Online checkout, plan Task 9. */
  create(model: string, values: Record<string, unknown>): Promise<number> {
    return todo('OdooClient.create', model, values);
  }

  /** Calls a model method on ids (execute_kw `method` [ids] kwargs), e.g. sale.order action_confirm. Plan Task 9. */
  call<T>(model: string, method: string, ids: number[], kwargs: Record<string, unknown> = {}): Promise<T> {
    return todo('OdooClient.call', model, method, ids, kwargs);
  }

  /**
   * When the integration user's API key stops working, or null for a key that
   * never expires. Odoo does not say which of the user's keys we hold, so with
   * several the soonest date wins: a warning too early beats none.
   */
  async keyExpiresAt(): Promise<Date | null> {
    const uid = await this.login();
    const keys = await this.searchRead<{ expiration_date: string | false }>('res.users.apikeys', [['user_id', '=', uid]], ['expiration_date']);
    const times = keys
      .filter((key) => key.expiration_date)
      // Odoo writes "2027-01-07 00:00:00", in UTC
      .map((key) => Date.parse(`${(key.expiration_date as string).replace(' ', 'T')}Z`))
      .filter((time) => !Number.isNaN(time));
    return times.length ? new Date(Math.min(...times)) : null;
  }

  private async login(): Promise<number> {
    if (this.uid === undefined) {
      const uid = await this.rpc<number | false>('common', 'authenticate', [this.cfg.db, this.cfg.login, this.cfg.apiKey, {}]);
      if (!uid) throw new OdooError('Odoo rejected the login. Check ODOO_DB, ODOO_LOGIN and ODOO_API_KEY.');
      this.uid = uid;
    }
    return this.uid;
  }

  private async execute<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown>): Promise<T> {
    const uid = await this.login();
    return this.rpc<T>('object', 'execute_kw', [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs]);
  }

  private async rpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
    const res = await this.fetchFn(`${this.cfg.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args } }),
      signal: AbortSignal.timeout(120_000),
    });
    let reply: RpcReply<T>;
    try {
      reply = (await res.json()) as RpcReply<T>;
    } catch {
      throw new OdooError(`Odoo answered HTTP ${res.status} with something that is not JSON. Check ODOO_URL.`);
    }
    if (reply.error) {
      const message = reply.error.data?.message ?? reply.error.message ?? 'unknown error';
      // Odoo sometimes echoes arguments back; the key must never reach a log
      throw new OdooError(`Odoo error: ${message.split(this.cfg.apiKey).join('***').slice(0, 500)}`);
    }
    return reply.result as T;
  }
}
