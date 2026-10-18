import type { OdooReader } from './odoo-sync';

/**
 * What writing to Odoo needs: a search plus `create` and an arbitrary model
 * method (`action_confirm`). OdooClient implements it (Task 9); tests pass a fake.
 */
export interface OdooWriter extends Pick<OdooReader, 'searchRead'> {
  create(model: string, values: Record<string, unknown>): Promise<number>;
  call<T>(model: string, method: string, ids: number[], kwargs?: Record<string, unknown>): Promise<T>;
}
