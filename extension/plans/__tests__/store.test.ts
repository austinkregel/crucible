import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PlanStore } from '../store';
import type { Plan } from '../../orchestrator/types';

const TEST_DIR = path.join(os.tmpdir(), 'crucible-plan-test-' + Date.now());

describe('PlanStore', () => {
  let store: PlanStore;

  const samplePlan: Plan = {
    plan: 'Add user authentication',
    steps: [
      {
        id: 'step-1',
        goal: 'Create auth module',
        files: ['lib/auth.ex', 'lib/auth/guardian.ex'],
        risks: ['Token expiry handling'],
        constraints: ['Must use Guardian'],
        status: 'pending',
      },
      {
        id: 'step-2',
        goal: 'Add login endpoint',
        files: ['lib/web/controllers/auth_controller.ex'],
        risks: [],
        constraints: [],
        status: 'pending',
      },
    ],
    assumptions: ['Phoenix framework is already set up', 'PostgreSQL is the database'],
  };

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    store = new PlanStore(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('save', () => {
    it('writes a markdown file to disk', () => {
      const meta = store.save(samplePlan, 'my_elixir_app');
      expect(fs.existsSync(meta.filePath)).toBe(true);
    });

    it('returns metadata with correct fields', () => {
      const meta = store.save(samplePlan, 'my_elixir_app', {
        approved: true,
        confidenceScore: 0.85,
      });
      expect(meta.project).toBe('my_elixir_app');
      expect(meta.name).toBe('Add user authentication');
      expect(meta.approved).toBe(true);
      expect(meta.confidenceScore).toBe(0.85);
      expect(meta.stepCount).toBe(2);
      expect(meta.id).toMatch(/^[a-f0-9]+$/);
    });

    it('uses project_name_hash naming scheme', () => {
      const meta = store.save(samplePlan, 'my_elixir_app');
      const fileName = path.basename(meta.filePath);
      expect(fileName).toMatch(/^my_elixir_app_[a-f0-9]+\.plan\.md$/);
    });

    it('sanitizes project names with special characters', () => {
      const meta = store.save(samplePlan, 'My App / v2.0');
      const fileName = path.basename(meta.filePath);
      expect(fileName).not.toContain('/');
      expect(fileName).not.toContain(' ');
      expect(fileName).toMatch(/\.plan\.md$/);
    });
  });

  describe('list', () => {
    it('returns empty array when no plans exist', () => {
      const plans = store.list();
      expect(plans).toEqual([]);
    });

    it('lists all saved plans', () => {
      store.save(samplePlan, 'project_a');
      store.save({ ...samplePlan, plan: 'Second plan' }, 'project_b');

      const plans = store.list();
      expect(plans).toHaveLength(2);
      const names = plans.map((p) => p.name).sort();
      expect(names).toEqual(['Add user authentication', 'Second plan']);
    });
  });

  describe('load', () => {
    it('loads a saved plan back as a Plan object', () => {
      const meta = store.save(samplePlan, 'my_app');
      const loaded = store.load(meta.filePath);

      expect(loaded).not.toBeNull();
      expect(loaded!.plan.plan).toBe('Add user authentication');
      expect(loaded!.plan.steps).toHaveLength(2);
      expect(loaded!.plan.steps[0].goal).toBe('Create auth module');
      expect(loaded!.plan.steps[0].files).toEqual(['lib/auth.ex', 'lib/auth/guardian.ex']);
      expect(loaded!.plan.assumptions).toEqual([
        'Phoenix framework is already set up',
        'PostgreSQL is the database',
      ]);
    });

    it('preserves step constraints and risks through round-trip', () => {
      const meta = store.save(samplePlan, 'my_app');
      const loaded = store.load(meta.filePath);

      expect(loaded!.plan.steps[0].constraints).toEqual(['Must use Guardian']);
      expect(loaded!.plan.steps[0].risks).toEqual(['Token expiry handling']);
    });

    it('returns null for non-existent file', () => {
      const loaded = store.load('/nonexistent/path.plan.md');
      expect(loaded).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes a plan file from disk', () => {
      const meta = store.save(samplePlan, 'my_app');
      expect(fs.existsSync(meta.filePath)).toBe(true);

      const result = store.delete(meta.filePath);
      expect(result).toBe(true);
      expect(fs.existsSync(meta.filePath)).toBe(false);
    });

    it('returns false for non-existent file', () => {
      const result = store.delete('/nonexistent/file.plan.md');
      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('overwrites an existing plan file', () => {
      const meta = store.save(samplePlan, 'my_app');
      const updatedPlan: Plan = {
        ...samplePlan,
        steps: [
          ...samplePlan.steps,
          { id: 'step-3', goal: 'Add tests', files: ['test/auth_test.exs'], risks: [], constraints: [], status: 'pending' },
        ],
      };

      store.update(meta.filePath, updatedPlan, 'my_app', { approved: true });

      const loaded = store.load(meta.filePath);
      expect(loaded!.plan.steps).toHaveLength(3);
      expect(loaded!.meta.approved).toBe(true);
    });
  });
});
