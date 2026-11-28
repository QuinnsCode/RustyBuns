"""What the web page may call. Only the names in __all__ are reachable.

Arguments and return values travel as JSON, so return dicts, lists, strings,
numbers, booleans and None (a numpy array needs .tolist()).
"""

import platform

from stats import summarize

__all__ = ["about", "summarize"]


def about() -> dict:
    return {"version": platform.python_version()}
