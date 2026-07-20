import * as vscode from 'vscode';
import * as fs from 'fs';
import { Embedder } from '../indexer/embedder';
import { VectorStore, type SearchResult } from '../indexer/vectorStore';
import type { Mention } from '../context/mentions';

export interface RetrievedChunk {
  relativePath: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  contextualizedText: string;
  entities: string;
  language: string;
  score: number;
}

/**
 * Retrieves the most relevant code chunks for a given query.
 *
 * Pipeline:
 *   1. Embed the query via Ollama
 *   2. Vector search in LanceDB (top 50)
 *   3. Apply scoring boosts (recency, active file, keyword, @mention)
 *   4. Fetch actual source from local filesystem
 *   5. Return top N chunks
 */
export class Retriever {
  constructor(
    private embedder: Embedder,
    private vectorStore: VectorStore,
  ) {}

  async retrieve(
    query: string,
    opts?: {
      limit?: number;
      activeFilePath?: string;
      mentions?: Mention[];
      recentFiles?: string[];
    },
  ): Promise<RetrievedChunk[]> {
    const limit = opts?.limit ?? 10;
    const candidateCount = Math.max(limit * 5, 50);

    // 1. Embed query
    const queryVector = await this.embedder.embed(query);

    // 2. Vector search
    const candidates = await this.vectorStore.search(queryVector, candidateCount);
    if (candidates.length === 0) return [];

    // 3. Score and boost
    const scored = candidates.map((c) => ({
      ...c,
      score: this.computeScore(c, query, opts),
    }));

    // 4. Sort by score descending and take top N
    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, limit);

    // 5. Fetch live source code from filesystem
    const results: RetrievedChunk[] = [];
    for (const candidate of topCandidates) {
      const content = this.fetchSourceLines(
        candidate.filePath,
        candidate.lineStart,
        candidate.lineEnd,
      );

      results.push({
        relativePath: candidate.relativePath,
        filePath: candidate.filePath,
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd,
        content: content || candidate.contextualizedText,
        contextualizedText: candidate.contextualizedText,
        entities: candidate.entities,
        language: candidate.language,
        score: candidate.score,
      });
    }

    return results;
  }

  private computeScore(
    candidate: SearchResult,
    query: string,
    opts?: {
      activeFilePath?: string;
      mentions?: Mention[];
      recentFiles?: string[];
    },
  ): number {
    // Base score: inverse of vector distance (lower distance = higher score)
    // LanceDB returns L2 distance; convert to a similarity
    const distance = candidate._distance ?? 1;
    let score = 1 / (1 + distance);

    // Active file boost: chunks from the currently open file get +0.3
    if (opts?.activeFilePath && candidate.filePath === opts.activeFilePath) {
      score += 0.3;
    }

    // @mention boost: explicitly mentioned files get +0.25
    if (opts?.mentions) {
      for (const mention of opts.mentions) {
        if (
          mention.type === 'file' &&
          candidate.relativePath.endsWith(mention.value)
        ) {
          score += 0.25;
          break;
        }
      }
    }

    // Recency boost: recently edited files get +0.15
    if (opts?.recentFiles?.includes(candidate.filePath)) {
      score += 0.15;
    }

    // Keyword match boost: exact identifier matches
    score += this.keywordBoost(query, candidate.contextualizedText);

    return score;
  }

  /**
   * Simple keyword/identifier matching boost.
   * Splits query into tokens and checks how many appear in the chunk text.
   */
  private keywordBoost(query: string, chunkText: string): number {
    const queryTokens = query
      .split(/[\s,.;:(){}[\]'"]+/)
      .filter((t) => t.length > 2)
      .map((t) => t.toLowerCase());

    if (queryTokens.length === 0) return 0;

    const lower = chunkText.toLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
      if (lower.includes(token)) matches++;
    }

    return (matches / queryTokens.length) * 0.2;
  }

  private fetchSourceLines(
    filePath: string,
    lineStart: number,
    lineEnd: number,
  ): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, lineStart - 1);
      const end = Math.min(lines.length, lineEnd);
      return lines.slice(start, end).join('\n');
    } catch {
      return null;
    }
  }
}

/**
 * Collect recently-edited file paths from VSCode's tab/editor history.
 */
export function getRecentFiles(): string[] {
  const recent: string[] = [];
  try {
    for (const tabGroup of vscode.window.tabGroups?.all ?? []) {
      for (const tab of tabGroup.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri) {
          recent.push(input.uri.fsPath);
        }
      }
    }
  } catch {
    // Editor surface not available (e.g. headless/test) -- recency is optional.
  }
  return recent;
}
