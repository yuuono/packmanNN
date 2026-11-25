import { PRESETS, rankActions } from './utility.js';
import { validateModel, WEIGHT_NAMES } from './model.js';
import { makeWeightSelector } from './controller.js';

const labels = ['目先の採餌', '全体の回収', '慎重さ', 'パワー活用'];
const arrows = { up: '↑', right: '→', down: '↓', left: '←' };
const byId = id => document.getElementById(id);

function redistribute(weights, changed, value) {
  const otherTotal = weights.reduce((sum, n, i) => sum + (i === changed ? 0 : n), 0);
  return weights.map((n, i) => {
    if (i === changed) return value;
    return (1 - value) * (otherTotal > 1e-10 ? n / otherTotal : 1 / (weights.length - 1));
  });
}

export function mountPanel(getGame, requested) {
  const mode = byId('ai-mode');
  const feedback = byId('ai-feedback');
  const policyName = byId('ai-model-option');
  const inputs = [];
  const outputs = [];
  let manual = [...PRESETS.find(preset => preset.id === 'balanced').weights];
  let model = null;
  let selectWeights = null;
  let request = 0;

  function reset() {
    selectWeights = model ? makeWeightSelector(model) : null;
  }

  function decision(game) {
    const neural = mode.value === 'nn' && selectWeights;
    const weights = neural ? selectWeights(game) : manual;
    weights.forEach((value, i) => {
      inputs[i].value = String(value * 100);
      inputs[i].disabled = Boolean(neural);
      outputs[i].textContent = Math.round(value * 100) + '%';
    });
    if (!['ready', 'playing'].includes(game.phase)) {
      byId('ai-route').textContent = '—';
      return null;
    }
    const ranked = rankActions(game, weights);
    byId('ai-route').textContent = ranked.map(({action, score}) =>
      arrows[action] + ' ' + score.toFixed(2)).join('　');
    return ranked[0].action;
  }

  for (const [index, name] of WEIGHT_NAMES.entries()) {
    const label = document.createElement('label');
    const text = document.createElement('span');
    const output = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.id = 'weight-' + name;
    label.htmlFor = slider.id;
    output.htmlFor = slider.id;
    text.textContent = labels[index];
    label.append(text, output, slider);
    byId('ai-sliders').append(label);
    inputs.push(slider);
    outputs.push(output);
    slider.addEventListener('input', () => {
      manual = redistribute(manual, index, Number(slider.value) / 100);
      decision(getGame());
    });
  }
  mode.addEventListener('change', () => { reset(); decision(getGame()); });

  async function load(read, name) {
    const current = ++request;
    feedback.textContent = 'モデルを確認しています…';
    try {
      const candidate = validateModel(await read());
      if (current !== request) return;
      model = candidate;
      reset();
      policyName.disabled = false;
      mode.value = 'nn';
      feedback.textContent = name + ' を読み込みました。';
      decision(getGame());
    } catch (error) {
      if (current === request) feedback.textContent = error.message;
    }
  }

  byId('ai-file').addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) load(async () => JSON.parse(await file.text()), file.name);
    event.target.value = '';
  });
  byId('ai-panel').hidden = false;
  decision(getGame());
  if (requested === 'nn') {
    load(async () => {
      const response = await fetch('./assets/personality-model.json');
      if (!response.ok) throw new Error('学習済みJSONを選ぶとNNに切り替わります。現在は手動の重みで動きます。');
      return response.json();
    }, '配布モデル');
  }
  return { decision, reset };
}
