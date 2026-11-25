import { FEATURE_NAMES, FEATURE_VERSION, POLICY_VERSION } from './utility.js';
import { ENGINE_VERSION } from '../game.js';

export const WEIGHT_NAMES = ['local', 'global', 'cautious', 'power'];
const matches = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const vector = (a, size) => Array.isArray(a) && a.length === size && a.every(Number.isFinite);

export function predictWeights(model, input) {
  if (!vector(input, FEATURE_NAMES.length)) throw new Error('入力特徴量の次元または値が不正です。');
  let values = input;
  for (const [index, layer] of model.layers.entries()) {
    values = layer.weights.map((row, out) => {
      const sum = row.reduce((value, weight, i) => value + weight * values[i], layer.bias[out]);
      return index === 0 ? Math.max(0, sum) : sum;
    });
  }
  const peak = Math.max(...values);
  const exps = values.map(value => Math.exp(value - peak));
  const sum = exps.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum === 0) throw new Error('モデルの出力が有限値になりません。');
  return exps.map(value => value / sum);
}

export function validateModel(model) {
  if (model?.format !== 'maze-personality-v1' || model.engine_version !== ENGINE_VERSION ||
      model.feature_version !== FEATURE_VERSION ||
      model.policy_version !== POLICY_VERSION || !matches(model.feature_names, FEATURE_NAMES) ||
      !matches(model.weight_names, WEIGHT_NAMES)) {
    throw new Error('モデルの形式・特徴量・方針の版がこのゲームと一致しません。');
  }
  if (!Array.isArray(model.layers) || model.layers.length !== 2) throw new Error('2層のMLPが必要です。');
  let width = FEATURE_NAMES.length;
  for (const layer of model.layers) {
    if (!Array.isArray(layer?.weights) || !layer.weights.length ||
        !vector(layer.bias, layer.weights.length) || !layer.weights.every(row => vector(row, width))) {
      throw new Error('モデルの重みまたはバイアスが不正です。');
    }
    width = layer.weights.length;
  }
  if (width !== WEIGHT_NAMES.length) throw new Error('性格の重みは4出力です。');
  const reference = model.parity;
  if (!reference || !vector(reference.output, width)) throw new Error('Pythonとの照合用の出力が必要です。');
  const actual = predictWeights(model, reference.input);
  if (!actual.every((value, i) => Math.abs(value - reference.output[i]) <= 1e-5)) {
    throw new Error('JSの推論結果が書き出し時の出力と一致しません。');
  }
  return model;
}
