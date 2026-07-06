export interface Plan {
  plan: string;
  steps: PlanStep[];
  assumptions: string[];
}

export interface PlanStep {
  id: string;
  goal: string;
  files: string[];
  risks: string[];
  constraints: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
}

export interface ValidationResult {
  issues: string[];
  missingCases: string[];
  conflicts: string[];
  confidenceScore: number;
  approved: boolean;
  raw?: string;
}

export interface ExecutionResult {
  stepId: string;
  success: boolean;
  diff?: string;
  error?: string;
  filesChanged: string[];
}

export interface PostValidationResult {
  approved: boolean;
  issues: string[];
  suggestedFixes: string[];
}

export interface OrchestratorEvent {
  type:
    | 'phaseStarted'
    | 'planGenerated'
    | 'validationComplete'
    | 'planRefined'
    | 'planComplete'
    | 'stepStarted'
    | 'stepCompleted'
    | 'stepFailed'
    | 'toolCallStarted'
    | 'toolCallCompleted'
    | 'toolCallFailed'
    | 'postValidationComplete'
    | 'streamToken'
    | 'error'
    | 'complete';
  data: any;
}

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;
