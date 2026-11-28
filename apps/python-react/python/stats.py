"""Stands in for your existing codebase: plain Python that knows nothing about the web."""

import statistics


def summarize(numbers: list[float]) -> dict:
    if not numbers:
        raise ValueError("give me at least one number")
    return {
        "count": len(numbers),
        "mean": statistics.fmean(numbers),
        "median": statistics.median(numbers),
        "stdev": statistics.pstdev(numbers),
    }
