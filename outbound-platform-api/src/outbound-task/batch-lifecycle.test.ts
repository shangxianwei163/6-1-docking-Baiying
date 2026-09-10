import { describe, expect, it } from 'vitest';
import { deriveIntakeBatchLifecycle } from './batch-lifecycle.js';

describe('deriveIntakeBatchLifecycle', () => {
  it('keeps a batch preparing until every child is ready', () => {
    expect(
      deriveIntakeBatchLifecycle([
        { executionStatus: 'IMPORTED' },
        { executionStatus: 'IMPORTING' },
      ]),
    ).toEqual({ executionStatus: 'PREPARING', allTerminal: false });
  });

  it('reports a running batch after at least one child starts', () => {
    expect(
      deriveIntakeBatchLifecycle([
        { executionStatus: 'CALLING' },
        { executionStatus: 'IMPORTED' },
      ]),
    ).toEqual({ executionStatus: 'RUNNING', allTerminal: false });
  });

  it('closes the start barrier on failure without completing the batch early', () => {
    expect(
      deriveIntakeBatchLifecycle([
        { executionStatus: 'IMPORT_FAILED' },
        { executionStatus: 'IMPORTED' },
      ]),
    ).toEqual({ executionStatus: 'FAILED', allTerminal: false });
  });

  it('keeps partial-start history after compensation changes all children to failures', () => {
    expect(
      deriveIntakeBatchLifecycle([
        {
          executionStatus: 'START_FAILED',
          startedAt: new Date('2026-09-09T01:00:00.000Z'),
        },
        { executionStatus: 'START_FAILED' },
      ]),
    ).toEqual({ executionStatus: 'PARTIAL_FAILED', allTerminal: true });
  });

  it.each([
    {
      tasks: [
        { executionStatus: 'COMPLETED' as const },
        { executionStatus: 'COMPLETED' as const },
      ],
      expected: { executionStatus: 'COMPLETED', allTerminal: true },
    },
    {
      tasks: [
        { executionStatus: 'COMPLETED' as const },
        { executionStatus: 'START_FAILED' as const },
      ],
      expected: { executionStatus: 'PARTIAL_FAILED', allTerminal: true },
    },
    {
      tasks: [
        { executionStatus: 'TERMINATED' as const },
        { executionStatus: 'CANCELLED' as const },
      ],
      expected: { executionStatus: 'CANCELLED', allTerminal: true },
    },
  ])('derives terminal batch state %#', ({ tasks, expected }) => {
    expect(deriveIntakeBatchLifecycle(tasks)).toEqual(expected);
  });
});
