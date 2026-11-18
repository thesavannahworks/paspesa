import { describe, expect, it } from 'vitest';
import { MemoryStore, reconcileAccount, setupAccount, type MemoryState } from '../src';
import { TEST_PIN, makeDeps, newOp, processSimulation } from './helpers';

describe('persisted store (offline local persistence)', () => {
  it('saves every committed state and restores it after a restart', async () => {
    let disk: string | null = null;
    const persist = async (s: MemoryState) => { disk = JSON.stringify(s); };
    const { deps } = makeDeps({ store: new MemoryStore(undefined, { persist }) });
    await setupAccount(deps, { operationId: 's', accountName: 'Amina', phoneNumber: '0798765432', openingBalance: 1_000, pin: TEST_PIN });
    await processSimulation(deps, { operationId: newOp(), type: 'RECHARGE', amount: 500, counterparty: {} });

    const restarted = new MemoryStore(JSON.parse(disk!), { persist });
    expect((await restarted.getAccount())!.currentBalanceCache).toBe(1_500);
    expect((await reconcileAccount(restarted)).ok).toBe(true);
  });

  it('a failed save rolls the operation back; the same operation ID then succeeds once', async () => {
    let failNext = false;
    let disk: string | null = null;
    const persist = async (s: MemoryState) => {
      if (failNext) { failNext = false; throw new Error('disk full'); }
      disk = JSON.stringify(s);
    };
    const store = new MemoryStore(undefined, { persist });
    const { deps } = makeDeps({ store });
    await setupAccount(deps, { operationId: 's', accountName: 'Amina', phoneNumber: '0798765432', openingBalance: 1_000, pin: TEST_PIN });
    const savedBefore = disk;

    const req = { operationId: newOp(), type: 'RECHARGE' as const, amount: 500, counterparty: {} };
    failNext = true;
    const failed = await processSimulation(deps, req);
    expect(!failed.ok && failed.error.code).toBe('STORAGE_FAILURE');
    expect((await store.getAccount())!.currentBalanceCache).toBe(1_000);
    expect(disk).toBe(savedBefore);

    const retried = await processSimulation(deps, req);
    expect(retried.ok && !retried.duplicate).toBe(true);
    expect(JSON.parse(disk!).account.currentBalanceCache).toBe(1_500);
  });

  it('loads states saved before newer collections existed', async () => {
    const legacy = { account: null, transactions: [], movements: [], messages: [], outbox: [] };
    const store = new MemoryStore(legacy);
    expect(await store.listFavourites()).toEqual([]);
  });
});
