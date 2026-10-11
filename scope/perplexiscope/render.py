"""Static overlays: word surprise as a tint, sentence surprise as an underline,
or AI-likeness per sentence. HTML, terminal, or JSON for perplexiscope.typ."""
from html import escape

RAMP = (242, 193, 78), (233, 128, 58), (194, 45, 86)
HUMAN, MACHINE = (42, 157, 143), (123, 79, 214)
UL, BG = "\x1b[4m\x1b[58:2::{}:{}:{}m", "\x1b[30;48;2;{};{};{}m"


def ink(bits, cap=16):  # (rgb, alpha) as in the app: expected stays unmarked
    t = min(bits / cap, 1)
    u = min(1.999, 2 * t)
    i = int(u)
    c = [round(a + (b - a) * (u - i)) for a, b in zip(RAMP[i], RAMP[i + 1])]
    return c, .72 * t ** 1.6 * (t >= .12)


def lean(z):  # (rgb, alpha): teal reads human, violet reads AI
    t = 2 * z["p"] - 1 if "p" in z else max(-1., min(z["z"] / 4, 1.))
    return MACHINE if t > 0 else HUMAN, .55 * abs(t) ** 1.3 * (abs(t) >= .1)


def doc(text, h):  # sentences of [space before, word, bits]; joins back to text
    W, at, k, out = h["words"], 0, 0, []
    for z in h["sents"]:
        ws = []
        for w in W[k:k + z["w"]]:
            ws.append([text[at:w["s"]], text[w["s"]:w["e"]], w["bits"]])
            at = w["e"]
        k += z["w"]
        out.append(dict(z, words=ws))
    return dict(sents=out, tail=text[at:], ai=h["ai"], ppl=h["ppl"])


def css(c, a):
    return f"rgb({c[0]} {c[1]} {c[2]} / {a:.2f})" if a else "transparent"


def tip(z):
    m = z["bits"] / z["n"]
    ai = f"AI {z['p']:.0%}" if "p" in z else f"AI-likeness z {z['z']:+.1f}"
    return f"perplexity {2 ** m:.1f}, {ai}"


def html(d, by="bits", cap=16):  # [jelinek1977perplexity; bao2024fastdetectgpt]
    out = ['<div style="white-space:pre-wrap;line-height:2.2">']
    for z in d["sents"]:
        u, a = ink(z["bits"] / z["w"], cap)
        for i, (sp, w, b) in enumerate(z["words"]):
            f = ink(b, cap) if by == "bits" else lean(z)
            out.append(escape(sp) + (i == 0) * (
                f'<span style="border-bottom:.15em solid {css(u, a and 1)}"'
                f' title="{tip(z)}">'))
            out.append(f'<span style="background:{css(*f)}" '
                       f'title="{b:.1f} bits">{escape(w)}</span>')
        out.append("</span>")
    return "".join(out) + escape(d["tail"]) + "</div>"


def ansi(d, by="bits", cap=16):
    out = []
    for z in d["sents"]:
        u, a = ink(z["bits"] / z["w"], cap)
        for i, (sp, w, b) in enumerate(z["words"]):
            c, f = ink(b, cap) if by == "bits" else lean(z)
            bg = BG.format(*(round(255 - f * (255 - x)) for x in c))
            out += [sp, UL.format(*u) if i == 0 and a else "",
                    bg + w + "\x1b[39;49m" if f else w]
        out.append("\x1b[24m")
    return "".join(out) + d["tail"] + "\x1b[0m"
