import { Project } from './entities/index.js';

import type { EntityManager } from 'typeorm';

/**
 * Serializes every write for one project inside the caller's transaction.
 *
 * Installation bindings, idempotency keys, and allowance reservations all depend on this order.
 */
export async function lockProject(manager: EntityManager, projectId: string): Promise<void> {
  await manager.findOne(Project, {
    select: { id: true },
    where: { id: projectId },
    lock: { mode: 'pessimistic_write' },
  });
}
