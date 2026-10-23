import { describe, it, expect, afterEach } from 'vitest';
import { resolveBudget, loadBudgetConfig, DEFAULT_BUDGET_CONFIG } from '../budgetConfig';
import type { BudgetConfig } from '../../contracts/budget';
import { _configStore } from '../../__mocks__/vscode';

describe('resolveBudget', () => {
  const config: BudgetConfig = {
    default: { maxIterations: 40, maxWallClockMs: 600000 },
    explore: { maxIterations: 60 },
    general: { maxIterations: 80, maxToolCalls: 200 },
  };

  it('merges a type-specific entry over default (specific wins)', () => {
    const budget = resolveBudget(config, 'general');
    expect(budget).toEqual({
      maxIterations: 80, // overridden
      maxWallClockMs: 600000, // inherited from default
      maxToolCalls: 200, // added by general
    });
  });

  it('inherits limits present only on default', () => {
    const budget = resolveBudget(config, 'explore');
    expect(budget).toEqual({
      maxIterations: 60, // overridden
      maxWallClockMs: 600000, // inherited
    });
  });

  it('returns a copy of default for an unknown agent type', () => {
    const budget = resolveBudget(config, 'nonexistent');
    expect(budget).toEqual({ maxIterations: 40, maxWallClockMs: 600000 });
    // Must be a copy, not the same reference.
    expect(budget).not.toBe(config.default);
  });

  it('returns a copy of default when asked for "default"', () => {
    const budget = resolveBudget(config, 'default');
    expect(budget).toEqual(config.default);
    expect(budget).not.toBe(config.default);
  });

  it('tolerates a missing default entry', () => {
    const budget = resolveBudget({ foo: { maxIterations: 5 } } as unknown as BudgetConfig, 'bar');
    expect(budget).toEqual({});
  });
});

describe('loadBudgetConfig', () => {
  afterEach(() => {
    delete _configStore['subagents.budgets'];
  });

  it('falls back to built-in defaults when config is absent', () => {
    expect(loadBudgetConfig()).toEqual(DEFAULT_BUDGET_CONFIG);
  });

  it('falls back to defaults when the configured value lacks a default entry', () => {
    _configStore['subagents.budgets'] = { explore: { maxIterations: 5 } };
    expect(loadBudgetConfig()).toEqual(DEFAULT_BUDGET_CONFIG);
  });

  it('returns the configured value when present and valid', () => {
    const custom: BudgetConfig = {
      default: { maxIterations: 10 },
      explore: { maxToolCalls: 3 },
    };
    _configStore['subagents.budgets'] = custom;
    expect(loadBudgetConfig()).toEqual(custom);
  });

  it('produces a resolvable config end-to-end', () => {
    const resolved = resolveBudget(loadBudgetConfig(), 'general');
    expect(resolved.maxIterations).toBe(80);
    expect(resolved.maxToolCalls).toBe(200);
    expect(resolved.maxWallClockMs).toBe(600000);
  });
});
