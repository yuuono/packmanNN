import { features, legalActions } from './utility.js';
import { predictWeights } from './model.js';

// Weights are chosen on entering a junction and held between junctions. The
// utility policy still chooses a legal movement every tick, just like a rollout.
export function makeWeightSelector(model) {
  let weights = null;
  let lastTick = -1;
  return game => {
    if (lastTick !== game.ticks && (!weights || legalActions(game).length >= 3)) {
      weights = predictWeights(model, features(game));
    }
    lastTick = game.ticks;
    return weights;
  };
}
