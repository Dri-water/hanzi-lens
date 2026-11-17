"""Generates the Hanzi Lens logo and README banners as SVG.

All text is converted to outlines from Noto Sans SC (SIL Open Font License),
so the SVGs look identical everywhere, with no font needed by the viewer.

    python tools/brand/build_brand.py [path/to/NotoSansSC-VF.ttf]

Outputs go to assets/: logo.svg, banner-light.svg, banner-dark.svg
"""

import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets"
FONT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("C:/Windows/Fonts/NotoSansSC-VF.ttf")

RED_TOP, RED_BOTTOM = "#E0483D", "#A8231D"
CREAM = "#FFF4DE"


class Face:
    def __init__(self, weight: int):
        font = TTFont(FONT)
        if "fvar" in font:
            font = instantiateVariableFont(font, {"wght": weight})
        self.cmap = font.getBestCmap()
        self.glyphs = font.getGlyphSet()
        self.upm = font["head"].unitsPerEm
        self.hmtx = font["hmtx"]

    def advance(self, ch: str, size: float) -> float:
        return self.hmtx[self.cmap[ord(ch)]][0] * size / self.upm

    def width(self, text: str, size: float, tracking: float = 0) -> float:
        return sum(self.advance(c, size) + tracking for c in text) - tracking

    def path(self, text: str, x: float, baseline: float, size: float, tracking: float = 0) -> str:
        """SVG path data for `text` with its baseline at y=baseline."""
        s = size / self.upm
        out = []
        for ch in text:
            name = self.cmap[ord(ch)]
            pen = SVGPathPen(self.glyphs)
            # font units are y-up; flip into SVG space
            self.glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
            out.append(pen.getCommands())
            x += self.advance(ch, size) + tracking
        return " ".join(c for c in out if c)


bold = Face(700)
medium = Face(500)
regular = Face(400)


def mark(x: float, y: float, size: float, uid: str) -> str:
    """The app icon: a lens over 词 ("word") on a red rounded square. Designed on a 128 grid."""
    k = size / 128
    glyph_size = 38
    gx = 56 - bold.width("词", glyph_size) / 2
    glyph = bold.path("词", gx, 54 + glyph_size * 0.37, glyph_size)
    return f"""
  <g transform="translate({x} {y}) scale({k})">
    <defs>
      <linearGradient id="bg-{uid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="{RED_TOP}"/><stop offset="1" stop-color="{RED_BOTTOM}"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="28" fill="url(#bg-{uid})"/>
    <circle cx="56" cy="54" r="33" fill="{CREAM}" fill-opacity="0.14" stroke="{CREAM}" stroke-width="9"/>
    <line x1="81" y1="79" x2="104" y2="102" stroke="{CREAM}" stroke-width="14" stroke-linecap="round"/>
    <path d="{glyph}" fill="{CREAM}"/>
  </g>"""


def logo() -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">{mark(0, 0, 128, "logo")}\n</svg>\n'


def banner(dark: bool) -> str:
    W, H = 1280, 340
    fg = "#F3EFE6" if dark else "#1F1D1A"
    sub = "#A9A398" if dark else "#6B655A"
    bg = "#1A1917" if dark else "#FBF8F2"
    border = "#33312C" if dark else "#E8E2D5"
    tints = ["#5A4415", "#173A57"] if dark else ["#FFE7A3", "#CFE8FF"]

    # Row 1: mark + wordmark, centered.
    title = "Hanzi Lens"
    mark_size, gap, tsize = 84, 24, 64
    tw = bold.width(title, tsize, -0.5)
    x0 = (W - (mark_size + gap + tw)) / 2
    parts = [mark(x0, 40, mark_size, "banner")]
    parts.append(f'<path d="{bold.path(title, x0 + mark_size + gap, 105, tsize, -0.5)}" fill="{fg}"/>')
    tagline = "Hover Chinese text. See where every word begins and ends."
    parts.append(f'<path d="{regular.path(tagline, (W - regular.width(tagline, 24)) / 2, 168, 24)}" fill="{sub}"/>')

    # Row 2: segmented example headline with alternating word tints, centered.
    words = [("特朗普", "Tèlǎngpǔ"), ("宣布", "xuānbù"), ("对华", "duì Huá"), ("加征", "jiāzhēng"), ("关税", "guānshuì")]
    size, y, pad, between = 44, 262, 8, 12
    total = sum(medium.width(w, size) + pad * 2 for w, _ in words) + between * (len(words) - 1)
    x = (W - total) / 2 + pad
    for i, (w, py) in enumerate(words):
        ww = medium.width(w, size)
        parts.append(
            f'<rect x="{x - pad:.1f}" y="{y - size * 0.92:.1f}" width="{ww + pad * 2:.1f}" height="{size * 1.22:.1f}" rx="8" fill="{tints[i % 2]}"/>'
        )
        parts.append(f'<path d="{medium.path(w, x, y, size)}" fill="{fg}"/>')
        pw = regular.width(py, 17)
        parts.append(f'<path d="{regular.path(py, x + ww / 2 - pw / 2, y + 36, 17)}" fill="{sub}"/>')
        x += ww + pad * 2 + between

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
        f'  <rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="20" fill="{bg}" stroke="{border}"/>\n'
        + "\n".join(parts)
        + "\n</svg>\n"
    )


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "logo.svg").write_text(logo(), encoding="utf-8")
    (OUT / "banner-light.svg").write_text(banner(False), encoding="utf-8")
    (OUT / "banner-dark.svg").write_text(banner(True), encoding="utf-8")
    print("wrote", ", ".join(p.name for p in OUT.glob("*.svg")))


if __name__ == "__main__":
    main()
