"""Train a small CPU MLP on candidate outcomes and export it for browser inference."""
import argparse
import copy
import json
import math
import os
from pathlib import Path
import tempfile

from dataset import (
    DEFAULT_SCORE, WEIGHT_NAMES, best_fixed_policy, parse_coefficients, read_records,
    split_episodes, target_weights,
)


def save_new_json(path, document):
    """Publish a complete file without replacing existing weights on retries."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=f".{path.name}.", delete=False) as temp:
        temporary_path = Path(temp.name)
        try:
            json.dump(document, temp, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            temp.write("\n")
            temp.flush()
            os.fsync(temp.fileno())
            os.link(temporary_path, path)
        finally:
            temporary_path.unlink(missing_ok=True)


def export_network(model, reference_input, torch):
    """Serialize PyTorch's [out, in] weights and a reference forward pass."""
    model.eval()
    with torch.no_grad():
        reference_output = model(reference_input).softmax(dim=0)
    return {
        "layers": [{"weights": layer.weight.detach().tolist(), "bias": layer.bias.detach().tolist()}
                   for layer in model if isinstance(layer, torch.nn.Linear)],
        "parity": {"input": reference_input.tolist(), "output": reference_output.tolist()},
    }


def fit(rows, args, torch):
    episode_ids = split_episodes(rows, args.seed)
    membership = {episode: split for split, ids in episode_ids.items() for episode in ids}
    by_split = {name: [] for name in episode_ids}
    for row in rows:
        by_split[membership[row["episode_id"]]].append(row)

    samples = {}
    counts = {}
    for name, group in by_split.items():
        observations, labels = [], []
        for row in group:
            label = target_weights(row, args.score_coefficients, args.target,
                                   args.margin, args.temperature)
            if label is not None:
                observations.append(row["features"])
                labels.append(label)
        counts[name] = {"snapshots": len(group), "labeled": len(labels)}
        if not labels:
            if name != "test":
                raise ValueError(f"{name} に学習対象の盤面がありません。異なるエピソードや方針差のある盤面を増やしてください")
            continue
        samples[name] = (torch.tensor(observations, dtype=torch.float32),
                         torch.tensor(labels, dtype=torch.float32))

    torch.manual_seed(args.seed)
    features = rows[0]["feature_names"]
    model = torch.nn.Sequential(torch.nn.Linear(len(features), 16), torch.nn.ReLU(),
                                torch.nn.Linear(16, len(WEIGHT_NAMES)))
    optimizer = torch.optim.Adam(model.parameters(), lr=args.rate)
    loss_function = torch.nn.MSELoss()
    train_x, train_y = samples["train"]
    val_x, val_y = samples["val"]
    best_loss, best_epoch, best_state = math.inf, 0, None
    for epoch in range(1, args.epochs + 1):
        model.train()
        optimizer.zero_grad()
        prediction = model(train_x).softmax(dim=1)
        loss_function(prediction, train_y).backward()
        optimizer.step()
        with torch.no_grad():
            model.eval()
            val_loss = loss_function(model(val_x).softmax(dim=1), val_y).item()
            if val_loss < best_loss:
                best_loss, best_epoch, best_state = val_loss, epoch, copy.deepcopy(model.state_dict())
    if best_state is None:
        raise ValueError("損失が有限値になりません。学習率と入力を確認してください")
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        errors = {name: loss_function(model(x).softmax(dim=1), y).item()
                  for name, (x, y) in samples.items()}
    return {
        "format": "maze-personality-v1",
        "engine_version": rows[0]["engine_version"],
        "feature_version": rows[0]["feature_version"],
        "policy_version": rows[0]["policy_version"],
        "feature_names": features, "weight_names": list(WEIGHT_NAMES),
        **export_network(model, val_x[0], torch),
        "split_episode_ids": episode_ids,
        "best_fixed_policy_id": best_fixed_policy(by_split["train"], args.score_coefficients),
        "training": {
            "target": args.target, "margin": args.margin, "temperature": args.temperature,
            "seed": args.seed, "learning_rate": args.rate, "epochs": args.epochs,
            "best_epoch": best_epoch, "weight_mse": errors, "split_counts": counts,
            "score_coefficients": args.score_coefficients, "horizon": rows[0]["horizon"],
            "stage_ids": sorted({row["stage_id"] for row in rows}),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="generator JSONL")
    parser.add_argument("--out", type=Path, required=True, help="new model JSON")
    parser.add_argument("--target", choices=["winner", "soft"], default="winner")
    parser.add_argument("--margin", type=float, default=1.0, help="minimum winner vs. runner-up gap")
    parser.add_argument("--temperature", type=float, default=2.0, help="soft-target temperature")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--rate", type=float, default=0.01, help="Adam learning rate")
    parser.add_argument("--score-coefficients", type=parse_coefficients, default=DEFAULT_SCORE,
                        help="JSON object replacing all default metric coefficients")
    args = parser.parse_args()
    if not math.isfinite(args.margin) or args.margin < 0:
        parser.error("--margin は0以上の有限値で指定してください")
    if not math.isfinite(args.temperature) or args.temperature <= 0:
        parser.error("--temperature は正の有限値で指定してください")
    if not math.isfinite(args.rate) or args.rate <= 0 or args.epochs < 1:
        parser.error("--rate と --epochs は正値で指定してください")
    if not 0 <= args.seed < 2 ** 63:
        parser.error("--seed は0以上2^63未満の整数で指定してください")
    if args.out.exists():
        parser.error(f"出力先は既に存在します: {args.out}")
    try:
        import torch
    except ImportError:
        parser.exit(1, "学習にはPyTorchが必要です。サーバーのPython環境に torch をインストールしてください。\n")
    try:
        result = fit(read_records(args.input), args, torch)
        save_new_json(args.out, result)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    print(json.dumps({"model": str(args.out), "best_fixed_policy_id": result["best_fixed_policy_id"],
                      **result["training"]}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
