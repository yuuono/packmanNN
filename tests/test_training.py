"""Check reporting, label semantics, and leakage barriers with in-memory records."""
import io
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))
from dataset import (DEFAULT_SCORE, PRESETS, best_fixed_policy, read_records, split_episodes,
                     summarize, target_weights)
from train import export_network


def example(episode, snapshot, points=(0, 0, 0, 0, 0), caught=()):
    row = {"schema_version": 1, "engine_version": "engine-1", "feature_version": "feature-1",
           "policy_version": "policy-1", "stage_id": "stage-1", "episode_id": episode,
           "snapshot_id": snapshot, "horizon": 32, "features": [0, 1],
           "feature_names": ["ratio", "distance"], "candidates": []}
    for i, policy in enumerate(PRESETS):
        died = policy in caught
        weights = [float(j == i) for j in range(4)] if i < 4 else [0.25] * 4
        row["candidates"].append({
            "policy_id": policy, "weights": weights, "first_move": "up" if i == 0 else "right",
            "metrics": {"steps": 32, "end_reason": "caught" if died else "horizon",
                        "death_step": 32 if died else None, "score_delta": points[i] * 10,
                        "dots": points[i], "powers": 0, "ghosts": 0, "cleared": False,
                        "lives_lost": int(died), "nearest_threat_distance": None,
                        "escape_count": 2, "power_ticks": 0}})
    return row


class TrainingDataTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("torch") and shutil.which("node"),
                         "cross-runtime inference check requires torch and Node.js")
    def test_export_matches_javascript_for_known_frozen_weights(self):
        import torch

        root = Path(__file__).resolve().parents[1]
        metadata_script = """
            import { FEATURE_VERSION, POLICY_VERSION, FEATURE_NAMES } from './ai/utility.js';
            import { ENGINE_VERSION } from './game.js';
            console.log(JSON.stringify({ engine_version: ENGINE_VERSION,
                feature_version: FEATURE_VERSION, policy_version: POLICY_VERSION,
                feature_names: FEATURE_NAMES }));
        """
        node = ["node", "--input-type=module", "-e"]
        metadata = json.loads(subprocess.check_output(node + [metadata_script], cwd=root, text=True))
        width = len(metadata["feature_names"])
        model = torch.nn.Sequential(torch.nn.Linear(width, 16), torch.nn.ReLU(), torch.nn.Linear(16, 4))
        with torch.no_grad():
            for p in model.parameters():
                p.copy_((torch.arange(p.numel()).reshape(p.shape) % 11 - 5) / 17)
        reference = torch.linspace(0.125, 0.875, width)
        other = reference.flip(0)
        payload = {"format": "maze-personality-v1", **metadata, "weight_names": list(PRESETS[:4]),
                   **export_network(model, reference, torch)}
        validate_script = """
            import { readFileSync } from 'node:fs';
            import { predictWeights, validateModel } from './ai/model.js';
            const { model, other } = JSON.parse(readFileSync(0, 'utf8'));
            console.log(JSON.stringify(predictWeights(validateModel(model), other)));
        """
        js_output = subprocess.check_output(node + [validate_script], cwd=root, text=True,
                                            input=json.dumps({"model": payload, "other": other.tolist()}))
        with torch.no_grad():
            python_output = model(other).softmax(dim=0).tolist()
        for js, py in zip(json.loads(js_output), python_output):
            self.assertAlmostEqual(js, py, places=6)

    def test_clear_winner_margin_and_full_ties(self):
        tie = example("e1", "tie")
        for method in ("winner", "soft"):
            self.assertIsNone(target_weights(tie, DEFAULT_SCORE, method, 0, 2))
        row = example("e1", "one", (1, 0, 0, 0, 0))
        self.assertEqual(target_weights(row, DEFAULT_SCORE, "winner", 1, 2), [1, 0, 0, 0])
        self.assertIsNone(target_weights(row, DEFAULT_SCORE, "winner", 1.1, 2))
        two_best = example("e1", "two", (1, 1, 0, 0, 0))
        self.assertIsNone(target_weights(two_best, DEFAULT_SCORE, "winner", 0, 2))
        mixture = target_weights(two_best, DEFAULT_SCORE, "soft", 0, 0.01)
        self.assertAlmostEqual(sum(mixture), 1)
        self.assertAlmostEqual(mixture[0], 0.5)
        self.assertAlmostEqual(mixture[1], 0.5)

    def test_group_split_is_stable_and_not_row_based(self):
        rows = [example(str(e), f"{e}-{i}") for e in range(8) for i in range(2)]
        split = split_episodes(rows, 42)
        self.assertEqual(split, split_episodes(list(reversed(rows)), 42))
        self.assertTrue(all(split.values()))
        joined = [e for group in split.values() for e in group]
        self.assertEqual(len(joined), len(set(joined)))
        self.assertEqual(set(joined), {r["episode_id"] for r in rows})
        with self.assertRaisesRegex(ValueError, "episode_id"):
            split_episodes(rows[:4], 42)

    def test_pilot_can_flag_an_avoidable_capture_on_final_step(self):
        rows = [example("e1", "s1", caught={"balanced"}), example("e2", "s2")]
        report = summarize(rows, DEFAULT_SCORE)
        self.assertEqual(report["balanced_rescued"], {"count": 1, "denominator": 2, "percent": 50})
        self.assertEqual(report["rescued_among_balanced_captures"]["percent"], 100)
        self.assertEqual(report["outcome_disagreement"]["percent"], 50)
        self.assertEqual(report["all_scores_tied"]["count"], 1)
        self.assertIsNone(summarize(rows[1:], DEFAULT_SCORE)["rescued_among_balanced_captures"]["percent"])
        self.assertEqual(best_fixed_policy(rows[1:], DEFAULT_SCORE), "balanced")
        self.assertNotEqual(best_fixed_policy(rows, DEFAULT_SCORE), "balanced")

    def test_reject_mixed_versions_and_duplicate_snapshots(self):
        row = example("e1", "a")
        def read(other):
            lines = io.StringIO("\n".join(json.dumps(r) for r in [row, other]))
            with patch.object(Path, "open", return_value=lines):
                return read_records("in-memory")
        self.assertEqual(len(read(dict(row, snapshot_id="b"))), 2)
        with self.assertRaisesRegex(ValueError, "snapshot_id"):
            read(row)
        with self.assertRaisesRegex(ValueError, "2 行目"):
            read(dict(row, snapshot_id="b", feature_version="feature-2"))


if __name__ == "__main__":
    unittest.main()
