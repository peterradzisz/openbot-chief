/**
 * Task complexity classification for workflows (Layer 2A zero-token rules + Layer 2B micro-classifier).
 * Evaluates task complexity before invoking heavy seat models. If the micro-classifier fails or is
 * unavailable, it gracefully skips without failing the workflow.
 */

export interface ComplexityResult {
  complexity: "trivial" | "normal" | "complex";
  reason: "rule" | "classifier" | "fallback-skip";
}

/**
 * Layer 2A: Zero-token heuristic checks on issue / task text.
 * Returns true if the task is clearly trivial (typos, small doc edits, dependency bumps).
 */
export function matchTrivialRule(text: string): boolean {
  if (!text || typeof text !== "string") return false;

  // Check for trivial issue labels in input text
  if (/labels?:\s*.*?\b(trivial|typo|docs?|documentation|readme|quickfix|chore\(deps\))\b/i.test(text)) {
    return true;
  }

  // Check for common trivial title or commit patterns
  if (/\b(fix typo|spelling mistake|fix spelling|update readme|bump version|bump deps)\b/i.test(text)) {
    return true;
  }

  // Explicit complexity markers inserted by tools or users
  if (/\[\s*(complexity:\s*)?trivial\s*\]/i.test(text) || /#trivial\b/i.test(text)) {
    return true;
  }

  return false;
}

/** Layer 2B: Prompt builder for lightweight micro-classifier. */
export function buildMicroClassifierPrompt(input: string): string {
  const snippet = input.length > 1200 ? `${input.slice(0, 1200)}\n...(truncated)` : input;
  return [
    "You are a software engineering task complexity classifier.",
    "Read the following task input and classify its complexity. Reply with exactly ONE WORD from: TRIVIAL, NORMAL, COMPLEX.",
    "- TRIVIAL: typos, small doc edits, dependency bumps, single-line trivial fixes.",
    "- NORMAL: standard bug fixes, small features, unit tests, local refactors.",
    "- COMPLEX: multi-system architectural changes, migrations, large features, protocol shifts.",
    `--- Task Input ---\n${snippet}`,
  ].join("\n\n");
}

/** Parses one of the expected complexity words from the classifier response. */
export function parseComplexityWord(text: string): "trivial" | "normal" | "complex" | null {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.trim().toLowerCase();
  if (/\btrivial\b/.test(cleaned)) return "trivial";
  if (/\bcomplex\b/.test(cleaned)) return "complex";
  if (/\bnormal\b/.test(cleaned)) return "normal";
  return null;
}

/**
 * Evaluates task complexity:
 * 1. Layer 2A: Runs zero-token heuristic rules.
 * 2. Layer 2B: If not matched and generateText is provided, queries micro-model.
 * 3. Graceful Fallback: If generateText fails, times out, or errors, skips to normal without failing.
 */
export async function evaluateTaskComplexity(
  input: string,
  generateText?: (prompt: string) => Promise<string>,
): Promise<ComplexityResult> {
  // Layer 2A: Zero-token heuristic check
  if (matchTrivialRule(input)) {
    return { complexity: "trivial", reason: "rule" };
  }

  // If no LLM generator available, skip gracefully
  if (!generateText) {
    return { complexity: "normal", reason: "fallback-skip" };
  }

  // Layer 2B: Micro-classifier with timeout and fail-safe skip
  const prompt = buildMicroClassifierPrompt(input);
  try {
    const responsePromise = generateText(prompt).then((res) => {
      const parsed = parseComplexityWord(res);
      if (parsed) return { complexity: parsed, reason: "classifier" as const };
      return { complexity: "normal" as const, reason: "fallback-skip" as const };
    });

    const timeoutPromise = new Promise<ComplexityResult>((resolve) => {
      setTimeout(() => resolve({ complexity: "normal", reason: "fallback-skip" }), 5000);
    });

    return await Promise.race([responsePromise, timeoutPromise]);
  } catch {
    // If micro-classifier fails or is unavailable, skip gracefully
    return { complexity: "normal", reason: "fallback-skip" };
  }
}
