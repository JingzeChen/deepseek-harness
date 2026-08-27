import type { SessionBriefProviderResult } from '@deepseek-ai/dsh-session-brief'

/** Human-authored expected claims for one offline brief fixture. */
export interface SessionBriefQualityEvidence {
  /** Case-insensitive terms allowed to appear as completed claims. */
  readonly completedTerms: readonly string[]
  /** Case-insensitive blocker terms the candidate must retain. */
  readonly blockerTerms: readonly string[]
}

/** Content-quality failures kept separate from runtime schema validation. */
export interface SessionBriefQualityResult {
  readonly inventedCompletion: string[]
  readonly omittedBlockers: string[]
  readonly passed: boolean
}

/**
 * Compare one generated candidate with human-authored fixture evidence.
 * @param candidate - schema-valid provider output under evaluation.
 * @param evidence - allowed completion and required blocker terms.
 * @returns unsupported completion and missing blocker findings.
 */
export function evaluateSessionBriefQuality(
  candidate: SessionBriefProviderResult,
  evidence: SessionBriefQualityEvidence,
): SessionBriefQualityResult {
  const completedTerms = evidence.completedTerms.map(term => term.toLocaleLowerCase())
  const blockerText = candidate.blockers.join('\n').toLocaleLowerCase()
  const inventedCompletion = candidate.completed.filter((item) => {
    const normalized = item.toLocaleLowerCase()
    return !completedTerms.some(term => normalized.includes(term))
  })
  const omittedBlockers = evidence.blockerTerms.filter(term =>
    !blockerText.includes(term.toLocaleLowerCase()))
  return {
    inventedCompletion,
    omittedBlockers,
    passed: inventedCompletion.length === 0 && omittedBlockers.length === 0,
  }
}
