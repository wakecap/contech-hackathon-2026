export const VERDICTS = ['supported', 'refuted', 'no_evidence'];

export function validateDecisions(value, claims, viewNames) {
  if (!value || !Array.isArray(value.decisions) || value.decisions.length !== claims.length)
    throw new Error('Response must answer every claim exactly once.');
  const expected = new Set(claims.map(c => c.claimId));
  const seen = new Set();
  for (const d of value.decisions) {
    if (!expected.has(d.claimId) || seen.has(d.claimId)) throw new Error('Unknown or duplicate claim ID.');
    seen.add(d.claimId);
    if (!VERDICTS.includes(d.verdict) || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1)
      throw new Error('Invalid verdict or confidence (expected 0..1).');
    if (typeof d.observation !== 'string' || !d.observation.trim() || typeof d.limitation !== 'string')
      throw new Error('Missing visual observation or limitation.');
    if (!Array.isArray(d.views) || d.views.some(v => !viewNames.includes(v))) throw new Error('Invalid evidence view.');
    if (d.verdict !== 'no_evidence' && !d.views.length) throw new Error('Decisive verdict requires an evidence view.');
  }
  return value.decisions;
}

// Each pass awards 100 * confidence points to its chosen categorical verdict.
// Average WITHIN each model first, then combine model weights. Extra passes
// improve stability without granting that model extra influence.
export function aggregate(claimId, models, records, policy) {
  const scores = Object.fromEntries(VERDICTS.map(v => [v, 0]));
  const perModel = [];
  let totalWeight = 0;
  for (const model of models) {
    const passes = records.filter(r => r.modelId === model.id).map(r => r.decisions.find(d => d.claimId === claimId));
    if (passes.length !== model.passes || passes.some(d => !d))
      return { claimId, status: 'error', verdict: null, reason: 'One or more configured passes failed; rerun to resume.' };
    const points = Object.fromEntries(VERDICTS.map(v => [v, 0]));
    for (const d of passes) points[d.verdict] += 100 * d.confidence / model.passes;
    for (const v of VERDICTS) scores[v] += points[v] * model.weight;
    totalWeight += model.weight;
    perModel.push({ modelId: model.id, points });
  }
  for (const v of VERDICTS) scores[v] /= totalWeight;
  const ranked = [...VERDICTS].sort((a, b) => scores[b] - scores[a]);
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  const winnerShare = sum ? scores[ranked[0]] / sum : 0;
  const margin = sum ? (scores[ranked[0]] - scores[ranked[1]]) / sum : 0;
  const review = winnerShare < policy.minimum_winner_share || margin < policy.minimum_margin ||
    scores[ranked[0]] < (policy.minimum_winner_points ?? 0);
  return { claimId, status: review ? 'needs_review' : 'ok', verdict: review ? null : ranked[0],
    leading_verdict: ranked[0], scores, winner_share: winnerShare, margin, per_model: perModel,
    score_meaning: 'Confidence-weighted agreement; not a calibrated probability of correctness.' };
}
