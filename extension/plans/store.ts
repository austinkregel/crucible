import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { Plan } from '../orchestrator/types';

export const DEFAULT_PLANS_DIR = path.join(os.homedir(), '.crucible', 'plans');

export interface StoredPlanMeta {
  id: string;
  name: string;
  project: string;
  createdAt: number;
  updatedAt: number;
  approved: boolean;
  confidenceScore?: number;
  stepCount: number;
  filePath: string;
}

/**
 * Persists plans as markdown files in ~/.crucible/plans/
 * Named as: {project_name}_{md5hash}.plan.md
 */
export class PlanStore {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_PLANS_DIR;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Save a plan to disk. Returns the stored metadata.
   */
  save(plan: Plan, projectName: string, meta?: { approved?: boolean; confidenceScore?: number }): StoredPlanMeta {
    const now = Date.now();
    const hash = crypto.createHash('md5')
      .update(plan.plan + now.toString())
      .digest('hex')
      .substring(0, 8);

    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const fileName = `${safeName}_${hash}.plan.md`;
    const filePath = path.join(this.dir, fileName);

    const markdown = planToMarkdown(plan, projectName, meta);
    fs.writeFileSync(filePath, markdown, 'utf-8');

    return {
      id: hash,
      name: plan.plan,
      project: projectName,
      createdAt: now,
      updatedAt: now,
      approved: meta?.approved ?? false,
      confidenceScore: meta?.confidenceScore,
      stepCount: plan.steps.length,
      filePath,
    };
  }

  /**
   * Update an existing plan file on disk.
   */
  update(filePath: string, plan: Plan, projectName: string, meta?: { approved?: boolean; confidenceScore?: number }): void {
    if (!fs.existsSync(filePath)) return;
    const markdown = planToMarkdown(plan, projectName, meta);
    fs.writeFileSync(filePath, markdown, 'utf-8');
  }

  /**
   * List all saved plans, sorted by most recent first.
   */
  list(): StoredPlanMeta[] {
    if (!fs.existsSync(this.dir)) return [];

    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.plan.md'));
    const plans: StoredPlanMeta[] = [];

    for (const file of files) {
      const filePath = path.join(this.dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parsePlanMarkdown(content, filePath, file);
        if (parsed) plans.push(parsed);
      } catch {
        // Skip unreadable files
      }
    }

    plans.sort((a, b) => b.updatedAt - a.updatedAt);
    return plans;
  }

  /**
   * Load a plan from disk by file path.
   */
  load(filePath: string): { plan: Plan; meta: StoredPlanMeta } | null {
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      const meta = parsePlanMarkdown(content, filePath, fileName);
      if (!meta) return null;

      const plan = markdownToPlan(content);
      if (!plan) return null;

      return { plan, meta };
    } catch {
      return null;
    }
  }

  /**
   * Delete a plan file.
   */
  delete(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

function planToMarkdown(plan: Plan, projectName: string, meta?: { approved?: boolean; confidenceScore?: number }): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push('---');
  lines.push(`project: ${projectName}`);
  lines.push(`created: ${now}`);
  lines.push(`updated: ${now}`);
  lines.push(`approved: ${meta?.approved ?? false}`);
  if (meta?.confidenceScore !== undefined) {
    lines.push(`confidence: ${meta.confidenceScore}`);
  }
  lines.push(`steps: ${plan.steps.length}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${plan.plan}`);
  lines.push('');

  if (plan.assumptions.length > 0) {
    lines.push('## Assumptions');
    lines.push('');
    for (const a of plan.assumptions) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');

  for (const step of plan.steps) {
    lines.push(`### ${step.id}: ${step.goal}`);
    lines.push('');
    if (step.files.length > 0) {
      lines.push(`**Files:** ${step.files.join(', ')}`);
      lines.push('');
    }
    if (step.constraints.length > 0) {
      lines.push('**Constraints:**');
      for (const c of step.constraints) {
        lines.push(`- ${c}`);
      }
      lines.push('');
    }
    if (step.risks.length > 0) {
      lines.push('**Risks:**');
      for (const r of step.risks) {
        lines.push(`- ${r}`);
      }
      lines.push('');
    }
    lines.push(`**Status:** ${step.status}`);
    if (step.result) {
      lines.push('');
      lines.push('**Result:**');
      lines.push('```');
      lines.push(step.result);
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n');
}

function parsePlanMarkdown(content: string, filePath: string, fileName: string): StoredPlanMeta | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const fm = frontmatterMatch[1];
  const get = (key: string): string | undefined => {
    const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match?.[1]?.trim();
  };

  const titleMatch = content.match(/^# (.+)$/m);
  const name = titleMatch?.[1] ?? fileName;

  const hashMatch = fileName.match(/_([a-f0-9]+)\.plan\.md$/);
  const id = hashMatch?.[1] ?? fileName;

  const project = get('project') ?? 'unknown';
  const created = get('created');
  const updated = get('updated');
  const approved = get('approved') === 'true';
  const confidence = get('confidence');
  const steps = get('steps');

  return {
    id,
    name,
    project,
    createdAt: created ? new Date(created).getTime() : 0,
    updatedAt: updated ? new Date(updated).getTime() : 0,
    approved,
    confidenceScore: confidence ? parseFloat(confidence) : undefined,
    stepCount: steps ? parseInt(steps, 10) : 0,
    filePath,
  };
}

function markdownToPlan(content: string): Plan | null {
  const titleMatch = content.match(/^# (.+)$/m);
  if (!titleMatch) return null;

  const plan = titleMatch[1];

  const assumptions: string[] = [];
  const assumptionsMatch = content.match(/## Assumptions\n\n([\s\S]*?)(?=\n## |\n*$)/);
  if (assumptionsMatch) {
    const lines = assumptionsMatch[1].split('\n');
    for (const line of lines) {
      const item = line.match(/^- (.+)$/);
      if (item) assumptions.push(item[1]);
    }
  }

  const steps: Plan['steps'] = [];
  const stepPattern = /### ([^:]+):\s*(.+)/g;
  let stepMatch;

  while ((stepMatch = stepPattern.exec(content)) !== null) {
    const id = stepMatch[1].trim();
    const goal = stepMatch[2].trim();
    const stepStart = stepMatch.index + stepMatch[0].length;
    const nextStep = content.indexOf('\n### ', stepStart);
    const stepBlock = content.substring(stepStart, nextStep === -1 ? undefined : nextStep);

    const filesMatch = stepBlock.match(/\*\*Files:\*\*\s*(.+)/);
    const files = filesMatch ? filesMatch[1].split(',').map((f) => f.trim()) : [];

    const constraints: string[] = [];
    const constraintsMatch = stepBlock.match(/\*\*Constraints:\*\*\n([\s\S]*?)(?=\n\*\*|\n*$)/);
    if (constraintsMatch) {
      for (const line of constraintsMatch[1].split('\n')) {
        const item = line.match(/^- (.+)$/);
        if (item) constraints.push(item[1]);
      }
    }

    const risks: string[] = [];
    const risksMatch = stepBlock.match(/\*\*Risks:\*\*\n([\s\S]*?)(?=\n\*\*|\n*$)/);
    if (risksMatch) {
      for (const line of risksMatch[1].split('\n')) {
        const item = line.match(/^- (.+)$/);
        if (item) risks.push(item[1]);
      }
    }

    const statusMatch = stepBlock.match(/\*\*Status:\*\*\s*(\w+)/);
    const status = (statusMatch?.[1] ?? 'pending') as 'pending' | 'running' | 'done' | 'failed';

    steps.push({ id, goal, files, risks, constraints, status });
  }

  return { plan, steps, assumptions };
}
