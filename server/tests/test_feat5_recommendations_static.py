"""Regression checks for the dynamically injected HH recommendations tab."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def test_recommendations_reads_top_level_state_binding():
    source = (ROOT.parent / "client/static/js/features/feat5_recommendations.js").read_text(
        encoding="utf-8"
    )

    assert "typeof State !== 'undefined'" in source
    assert "var snap = appState && appState.lastSnapshot" in source


def test_recommendations_asset_cachebuster_is_current():
    html = (ROOT.parent / "client/static/index.html").read_text(encoding="utf-8")

    assert re.search(r'features/feat5_recommendations\.js\?v=\d+', html)
