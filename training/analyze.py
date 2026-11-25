"""Summarize the 100-snapshot pilot before training, using only the standard library."""
import argparse
import json

from dataset import DEFAULT_SCORE, parse_coefficients, read_records, summarize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="generator JSONL")
    parser.add_argument("--score-coefficients", type=parse_coefficients, default=DEFAULT_SCORE,
                        help="JSON object replacing all default metric coefficients")
    args = parser.parse_args()
    try:
        result = summarize(read_records(args.input), args.score_coefficients)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
