#!/usr/bin/env python3
"""Render the Open Graph unfurl images for the project pages.

    python3 projects/og/build_og.py

Renders each card below to a 1200x630 PNG (at 2x for sharpness) with headless
Chrome, then writes it next to the page it belongs to. Re-run after changing a
headline or a number; output is deterministic.
"""

import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # /projects

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H, SCALE = 1200, 630, 2

# The project page palette: one sequential blue hue stepped light->dark.
BLUE_LIGHT, BLUE_MID, BLUE_DARK = "#86b6ef", "#2a78d6", "#104281"
INK, INK_2, INK_3 = "#0b0b0b", "#52514e", "#85837c"
RULE = "#e4e2dd"

SHELL = """<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css?family=Raleway:400,600,700" rel="stylesheet">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html, body {{ width:{w}px; height:{h}px; }}
  body {{
    background:#fff; color:{ink};
    font-family:'Raleway', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding:64px 72px; display:flex; flex-direction:column;
    border-top:14px solid {blue_dark};
  }}
  .eyebrow {{
    font-size:23px; font-weight:600; letter-spacing:.14em;
    text-transform:uppercase; color:{ink3};
  }}
  h1 {{ font-size:{title_size}px; font-weight:700; line-height:1.08; letter-spacing:-.025em; }}
  .sub {{ font-size:27px; line-height:1.4; color:{ink2}; }}
  .spacer {{ flex:1 1 auto; }}
  .foot {{
    display:flex; align-items:baseline; gap:14px;
    font-size:22px; color:{ink3}; border-top:2px solid {rule}; padding-top:18px;
  }}
</style></head><body>{body}</body></html>"""


def card(body, title_size=72):
    return SHELL.format(
        w=W, h=H, ink=INK, ink2=INK_2, ink3=INK_3, rule=RULE,
        blue_dark=BLUE_DARK, title_size=title_size, body=body,
    )


def bar(segments):
    """Stacked distribution bar: [(count, colour, label), ...]."""
    bars = "".join(
        f'<div style="flex:{n};background:{c};border-radius:6px"></div>' for n, c, _ in segments
    )
    keys = "".join(
        f'<span style="display:inline-flex;align-items:center;gap:9px">'
        f'<span style="width:17px;height:17px;border-radius:4px;background:{c}"></span>{lab}</span>'
        for _, c, lab in segments
    )
    return (
        f'<div style="display:flex;gap:4px;height:54px;margin-bottom:16px">{bars}</div>'
        f'<div style="display:flex;gap:30px;font-size:22px;color:{INK_2}">{keys}</div>'
    )


CARDS = {
    # page directory (relative to /projects) -> card html
    "connie-chan-ai": card(
        f"""
        <div class="eyebrow">barakgila.com / projects</div>
        <h1 style="margin:20px 0 22px;max-width:24ch">Connie Chan is using LLMs to run her campaign</h1>
        <div class="sub" style="max-width:52ch">
          An AI-text detector finds generated content in
          <strong style="color:{INK}">11 of the 19 emails</strong> her CA&#8209;11 campaign sent
          in 27 days &mdash; and reads <strong style="color:{INK}">6</strong> as machine-written
          end to end.
        </div>
        <div class="spacer"></div>
        {bar([(8, BLUE_LIGHT, "8 human"), (5, BLUE_MID, "5 partly AI"), (6, BLUE_DARK, "6 entirely AI")])}
        """,
        title_size=58,
    ),
    "sf/streamlined-homes": card(
        f"""
        <div class="eyebrow">barakgila.com / projects</div>
        <h1 style="margin:22px 0 26px;max-width:16ch">Streamlined Housing in San Francisco</h1>
        <div class="sub" style="max-width:44ch">
          Every San Francisco project moving through California's streamlined state approval
          laws &mdash; SB&nbsp;35, SB&nbsp;828 and SB&nbsp;423 &mdash; mapped and tracked.
        </div>
        <div class="spacer"></div>
        <div style="display:flex;gap:64px;border-top:2px solid {RULE};padding-top:22px">
          <div><div style="font-size:52px;font-weight:700;letter-spacing:-.02em">110</div>
               <div style="font-size:22px;color:{INK_3};margin-top:2px">projects in the pipeline</div></div>
          <div><div style="font-size:52px;font-weight:700;letter-spacing:-.02em">12,873</div>
               <div style="font-size:22px;color:{INK_3};margin-top:2px">homes</div></div>
          <div><div style="font-size:52px;font-weight:700;letter-spacing:-.02em">3,516</div>
               <div style="font-size:22px;color:{INK_3};margin-top:2px">below market rate</div></div>
        </div>
        """,
        title_size=72,
    ),
    ".": card(
        f"""
        <div class="eyebrow">barakgila.com</div>
        <h1 style="margin:22px 0 30px">Projects</h1>
        <div class="sub" style="max-width:46ch">
          Data projects on San Francisco politics, housing and campaigns.
        </div>
        <div class="spacer"></div>
        <div style="font-size:26px;line-height:1.75;color:{INK_2};border-top:2px solid {RULE};padding-top:20px">
          Connie Chan is using LLMs to run her campaign<br>
          Streamlined Housing in San Francisco<br>
          Californians for Fair Property Taxes
        </div>
        """,
        title_size=88,
    ),
}


def render(html, out_png):
    tmp = tempfile.mkdtemp()
    try:
        src = os.path.join(tmp, "card.html")
        with open(src, "w", encoding="utf-8") as f:
            f.write(html)
        shot = os.path.join(tmp, "shot.png")
        subprocess.run(
            [
                CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                f"--screenshot={shot}", f"--window-size={W},{H}",
                f"--force-device-scale-factor={SCALE}",
                "--default-background-color=FFFFFF",
                "--virtual-time-budget=4000",
                f"file://{src}",
            ],
            check=True, capture_output=True, timeout=120,
        )
        os.makedirs(os.path.dirname(out_png), exist_ok=True)
        shutil.move(shot, out_png)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    for rel, html in CARDS.items():
        out = os.path.normpath(os.path.join(ROOT, rel, "og.png"))
        render(html, out)
        size = os.path.getsize(out)
        dims = subprocess.run(
            ["magick", "identify", "-format", "%wx%h", out],
            capture_output=True, text=True,
        ).stdout.strip()
        print(f"  {os.path.relpath(out, os.path.dirname(ROOT))}  {dims}  {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
