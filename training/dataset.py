"""JSONL validation, outcome scoring and episode-grouped sampling for Maze Chase."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

PRESETS = ("local", "global", "cautious", "power", "balanced")
WEIGHT_NAMES = PRESETS[:4]
OUTCOME_FIELDS = ("end_reason", "death_step", "dots", "powers", "ghosts",
                  "score_delta", "lives_lost", "cleared")
DEFAULT_SCORE = {"dots": 1, "powers": 1, "ghosts": 2, "lives_lost": -32, "cleared": 64}
SCORE_FIELDS = (set(OUTCOME_FIELDS) - {"end_reason"}) | {
    "steps", "nearest_threat_distance", "escape_count", "power_ticks",
}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def parse_coefficients(value):
    weights = json.loads(value)
    if not isinstance(weights, dict) or not weights:
        raise ValueError("採点式には指標名と係数のJSONオブジェクトを指定してください")
    for key, coefficient in weights.items():
        if key not in SCORE_FIELDS or not finite(coefficient):
            raise ValueError(f"未対応の指標または不正な係数: {key}")
    return weights


def read_records(path):
    rows = []
    seen_ids = set()
    versions = None
    reference_presets = None
    with Path(path).open(encoding="utf-8") as source:
        for line_no, line in enumerate(source, start=1):
            try:
                row = json.loads(line)
                if row["schema_version"] != 1:
                    raise ValueError("未対応の schema_version")
                names = row["feature_names"]
                values = row["features"]
                if (not isinstance(names, list) or not names or
                        not all(isinstance(name, str) and name for name in names) or
                        len(set(names)) != len(names) or len(values) != len(names) or
                        not all(finite(v) for v in values)):
                    raise ValueError("特徴名・次元・数値が不正")
                if not all(isinstance(row[k], str) and row[k] for k in
                           ("snapshot_id", "episode_id", "stage_id")):
                    raise ValueError("snapshot_id・episode_id・stage_idは空でない文字列が必要")
                if row["snapshot_id"] in seen_ids:
                    raise ValueError("snapshot_id が重複")
                seen_ids.add(row["snapshot_id"])
                row_versions = tuple(row[k] for k in
                                     ("engine_version", "feature_version", "policy_version", "horizon"))
                if versions is None:
                    versions = (row_versions, names)
                elif versions != (row_versions, names):
                    raise ValueError("版・特徴名の順序・ロールアウトの手数が混在")
                candidates = row["candidates"]
                if len(candidates) != len(PRESETS) or {c["policy_id"] for c in candidates} != set(PRESETS):
                    raise ValueError("5方針が過不足なく必要")
                preset_weights = {}
                for candidate in candidates:
                    weights = candidate["weights"]
                    if (len(weights) != len(WEIGHT_NAMES) or
                            not all(finite(w) and w >= 0 for w in weights) or
                            not math.isclose(sum(weights), 1, abs_tol=1e-6)):
                        raise ValueError("候補の4重みは非負で合計1が必要")
                    preset_weights[candidate["policy_id"]] = weights
                    metrics = candidate["metrics"]
                    if metrics["end_reason"] not in ("caught", "clear", "horizon"):
                        raise ValueError("不正な end_reason")
                    for key in SCORE_FIELDS:
                        number = metrics[key]
                        if key in {"nearest_threat_distance", "death_step"} and number is None:
                            continue
                        if key == "cleared" and isinstance(number, bool):
                            continue
                        if not finite(number):
                            raise ValueError(f"指標 {key} が不正")
                    if (metrics["death_step"] is not None) != (metrics["end_reason"] == "caught"):
                        raise ValueError("death_step と end_reason が矛盾")
                    if candidate["first_move"] not in (None, "left", "right", "up", "down"):
                        raise ValueError("不正な first_move")
                if reference_presets is None:
                    reference_presets = preset_weights
                elif preset_weights != reference_presets:
                    raise ValueError("同一方針の重みが混在")
            except (KeyError, TypeError, ValueError, OverflowError) as exc:
                raise ValueError(f"{path} の {line_no} 行目: {exc}") from exc
            rows.append(row)
    if not rows:
        raise ValueError("JSONLに盤面がありません")
    return rows


def score(candidate, coefficients):
    metrics = candidate["metrics"]
    # A missing death time or threat distance contributes zero to a custom formula.
    result = sum(coefficient * (metrics[key] or 0) for key, coefficient in coefficients.items())
    if not math.isfinite(result):
        raise ValueError("候補の評価が有限値の範囲を超えました")
    return result


def target_weights(row, coefficients, method, margin, temperature):
    candidates = row["candidates"]
    values = [score(c, coefficients) for c in candidates]
    order = sorted(range(len(values)), key=values.__getitem__, reverse=True)
    best = values[order[0]]
    if best == values[order[-1]]:
        return None
    if method == "winner":
        gap = best - values[order[1]]
        if gap == 0 or gap < margin:
            return None
        return list(candidates[order[0]]["weights"])
    if method != "soft" or temperature <= 0:
        raise ValueError("教師の方式または温度が不正")
    raw = [math.exp((value - best) / temperature) for value in values]
    total = sum(raw)
    return [sum(r * c["weights"][i] for r, c in zip(raw, candidates)) / total
            for i in range(len(WEIGHT_NAMES))]


def split_episodes(rows, seed):
    ids = sorted({row["episode_id"] for row in rows})
    if len(ids) < 3:
        raise ValueError("train・val・testの分割に3つ以上の異なるepisode_idが必要です")
    ids.sort(key=lambda episode: hashlib.sha256(f"{seed}:{episode}".encode()).digest())
    n_holdout = max(1, round(0.15 * len(ids)))
    cut = len(ids) - 2 * n_holdout
    return {"train": ids[:cut], "val": ids[cut:cut + n_holdout], "test": ids[cut + n_holdout:]}


def best_fixed_policy(rows, coefficients):
    totals = {policy: 0.0 for policy in PRESETS}
    for row in rows:
        for candidate in row["candidates"]:
            totals[candidate["policy_id"]] += score(candidate, coefficients)
    # Balanced is a reproducible tie-break for otherwise equivalent baselines.
    return max(("balanced", *WEIGHT_NAMES), key=totals.__getitem__)


def rate(count, denominator):
    return {"count": count, "denominator": denominator,
            "percent": round(100 * count / denominator, 2) if denominator else None}


def summarize(rows, coefficients):
    first_differ = outcome_differ = rescues = balanced_deaths = all_ties = best_ties = 0
    policies = {p: {"unique_win": 0, "tied_for_best": 0, "below_best": 0} for p in PRESETS}
    for row in rows:
        candidates = row["candidates"]
        first_differ += len({c["first_move"] for c in candidates}) > 1
        outcomes = {tuple(c["metrics"][key] for key in OUTCOME_FIELDS) for c in candidates}
        outcome_differ += len(outcomes) > 1
        caught = {c["policy_id"] for c in candidates if c["metrics"]["end_reason"] == "caught"}
        balanced_deaths += "balanced" in caught
        rescues += "balanced" in caught and len(caught) < len(PRESETS)
        scores = {c["policy_id"]: score(c, coefficients) for c in candidates}
        high = max(scores.values())
        winners = {p for p, value in scores.items() if value == high}
        all_ties += len(winners) == len(PRESETS)
        best_ties += len(winners) > 1
        for p in PRESETS:
            if p not in winners:
                policies[p]["below_best"] += 1
            elif len(winners) == 1:
                policies[p]["unique_win"] += 1
            else:
                policies[p]["tied_for_best"] += 1
    n = len(rows)
    return {
        "snapshots": n, "episodes": len({r["episode_id"] for r in rows}),
        "first_move_disagreement": rate(first_differ, n),
        "outcome_disagreement": rate(outcome_differ, n), "outcome_fields": list(OUTCOME_FIELDS),
        "balanced_rescued": rate(rescues, n),
        "rescued_among_balanced_captures": rate(rescues, balanced_deaths),
        "all_scores_tied": rate(all_ties, n), "best_score_tied": rate(best_ties, n),
        "policies": policies, "score_coefficients": coefficients,
    }
