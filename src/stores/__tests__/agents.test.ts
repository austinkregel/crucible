import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAgentsStore } from '../agents';
import {
  makeRef,
  treeMsg,
  eventMsg,
  questionMsg,
  questionResolvedMsg,
  agentId,
  runId,
  questionId,
} from '../../__mocks__/agentMessages';

// Stub the VS Code webview API so store actions that post messages are observable.
const postMessage = vi.fn();
(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage,
  getState: () => undefined,
  setState: () => undefined,
});

describe('agents store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    postMessage.mockClear();
  });

  describe('agent tree', () => {
    it('creates a lane on first tree message and updates its state', () => {
      const store = useAgentsStore();
      const ref = makeRef({ runId: 'r1', agentId: 'a1', agentType: 'explore' });

      store.handleMessage(treeMsg(ref, 'running'));
      expect(store.laneList).toHaveLength(1);
      expect(store.laneFor(ref.agentId)?.state).toBe('running');
      expect(store.laneFor(ref.agentId)?.ref.agentType).toBe('explore');

      store.handleMessage(treeMsg(ref, 'done'));
      expect(store.laneList).toHaveLength(1);
      expect(store.laneFor(ref.agentId)?.state).toBe('done');
    });

    it('tracks multiple concurrent agents as separate lanes', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });

      store.handleMessage(treeMsg(a, 'running'));
      store.handleMessage(treeMsg(b, 'running'));

      expect(store.laneList).toHaveLength(2);
      expect(store.activeLanes).toHaveLength(2);
    });

    it('activeLanes excludes terminal agents', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });
      store.handleMessage(treeMsg(a, 'running'));
      store.handleMessage(treeMsg(b, 'done'));

      expect(store.laneList).toHaveLength(2);
      expect(store.activeLanes.map((l) => l.ref.agentId)).toEqual([a.agentId]);
    });
  });

  describe('per-agent event lanes', () => {
    it("two agents' events do not clobber each other", () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });
      store.handleMessage(treeMsg(a, 'running'));
      store.handleMessage(treeMsg(b, 'running'));

      store.handleMessage(eventMsg(a, 'streamToken', { token: 'hello from A' }));
      store.handleMessage(eventMsg(b, 'toolCallStarted', { tool: 'edit_file' }));
      store.handleMessage(eventMsg(a, 'notice', { message: 'A notice' }));

      const laneA = store.laneFor(a.agentId)!;
      const laneB = store.laneFor(b.agentId)!;
      expect(laneA.events).toHaveLength(2);
      expect(laneB.events).toHaveLength(1);
      expect(laneA.events[0].data).toEqual({ token: 'hello from A' });
      expect(laneB.events[0].type).toBe('toolCallStarted');
    });

    it('creates a lane implicitly if an event arrives before its tree message', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'lonely', agentType: 'general' });
      store.handleMessage(eventMsg(a, 'notice', { message: 'early' }));

      expect(store.laneFor(a.agentId)).toBeDefined();
      expect(store.laneFor(a.agentId)?.events).toHaveLength(1);
    });
  });

  describe('concurrent pending questions', () => {
    it('holds MULTIPLE simultaneous questions keyed by QuestionId', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });

      store.handleMessage(questionMsg('q1', a, { kind: 'choice', prompt: 'A?', options: ['x', 'y'] }));
      store.handleMessage(questionMsg('q2', b, { kind: 'text', prompt: 'B?' }));

      expect(store.pendingQuestionCount).toBe(2);
      expect(store.waitingAgentCount).toBe(2);
      expect(store.pendingQuestions.map((q) => q.id)).toEqual([questionId('q1'), questionId('q2')]);
    });

    it('drops only the resolved question, leaving others pending', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });
      store.handleMessage(questionMsg('q1', a, { kind: 'text', prompt: 'A?' }));
      store.handleMessage(questionMsg('q2', b, { kind: 'text', prompt: 'B?' }));

      store.handleMessage(questionResolvedMsg('q1'));

      expect(store.pendingQuestionCount).toBe(1);
      expect(store.pendingQuestions[0].id).toBe(questionId('q2'));
    });

    it('attributes questions to their asking agent', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      const b = makeRef({ runId: 'r1', agentId: 'b', agentType: 'edit' });
      store.handleMessage(questionMsg('q1', a, { kind: 'text', prompt: 'A?' }));
      store.handleMessage(questionMsg('q2', b, { kind: 'text', prompt: 'B?' }));

      expect(store.questionsForAgent(a.agentId).map((q) => q.id)).toEqual([questionId('q1')]);
      expect(store.questionsForAgent(b.agentId).map((q) => q.id)).toEqual([questionId('q2')]);
    });
  });

  describe('outbound actions', () => {
    it('answerQuestion posts answerQuestion and drops it locally', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      store.handleMessage(questionMsg('q1', a, { kind: 'text', prompt: 'A?' }));

      store.answerQuestion(questionId('q1'), { text: 'my answer' });

      expect(postMessage).toHaveBeenCalledWith({
        type: 'answerQuestion',
        id: questionId('q1'),
        answer: { text: 'my answer' },
      });
      expect(store.pendingQuestionCount).toBe(0);
    });

    it('cancelAgent posts cancelAgent', () => {
      const store = useAgentsStore();
      store.cancelAgent(agentId('a'));
      expect(postMessage).toHaveBeenCalledWith({ type: 'cancelAgent', agentId: agentId('a') });
    });

    it('cancelRun posts cancelRun', () => {
      const store = useAgentsStore();
      store.cancelRun(runId('r1'));
      expect(postMessage).toHaveBeenCalledWith({ type: 'cancelRun', runId: runId('r1') });
    });
  });

  describe('reset', () => {
    it('clears lanes and questions', () => {
      const store = useAgentsStore();
      const a = makeRef({ runId: 'r1', agentId: 'a', agentType: 'explore' });
      store.handleMessage(treeMsg(a, 'running'));
      store.handleMessage(questionMsg('q1', a, { kind: 'text', prompt: 'A?' }));

      store.reset();

      expect(store.laneList).toHaveLength(0);
      expect(store.pendingQuestionCount).toBe(0);
    });
  });
});
