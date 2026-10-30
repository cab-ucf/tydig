# docs/attachment-a.docx (ARPA-H's mandatory template) filled from
# grant.yaml and summary.typ into out/summary.docx: instructions deleted,
# the cover sheet's answers in, items 1-3 in 12 pt Arial, the plan at 10 pt.
# [Bracketed] placeholders stay yellow until grant.yaml fills them.
import re, shutil, sys, tempfile, zipfile
from xml.sax.saxutils import escape
from ruamel.yaml import YAML

G = YAML(typ='safe').load(open('grant.yaml'))
pi = G['investigators'][0]
team = G['investigators'][1:]
TOPICS = re.findall(r'"([^"]+)"', open('lib/ehi.typ').read().split('#let topics')[1].split('#let topic ')[0])
topic = f"Topic {G['topic']}: {TOPICS[G['topic'] - 1]}"
I = G['institution']

def run(t, sz=24, b=False):
    hl = '<w:highlight w:val="yellow"/>' if re.search(r'\[.+\]', t) else ''
    return (f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
            f'{"<w:b/>" if b else ""}{hl}<w:sz w:val="{sz}"/></w:rPr>'
            f'<w:t xml:space="preserve">{escape(t)}</w:t></w:r>')

def rich(t, sz=24):  # *bold* spans
    return ''.join(run(s, sz, i % 2) for i, s in enumerate(t.split('*')) if s)

def para(t, sz=24, jc='both', after=80, b=False, keep=False):
    return (f'<w:p><w:pPr>{"<w:keepNext/>" if keep else ""}<w:spacing w:after="{after}" w:line="240" w:lineRule="auto"/>'
            f'<w:jc w:val="{jc}"/></w:pPr>{run(t, sz, b) if b else rich(t, sz)}</w:p>')

def cell(lines, w):
    return (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/></w:tcPr>'
            + ''.join(para(l, 20, 'left', 0) for l in lines) + '</w:tc>')

def items():  # items 1-3 of summary.typ, as paragraphs
    s = open('summary.typ').read()
    s = s[s.index('= 1. Define'):s.index('#plan()')]
    out = {}
    for h, body in re.findall(r'= (\d)\. [^\n]*\n(.*?)(?=\n  = \d\.|\Z)', s, re.S):
        body = re.sub(r'#todo\[(.*?)\]', r'[\1]', body, flags=re.S).replace('\\$', '$')
        out[h] = [' '.join(p.split()) for p in body.strip().split('\n\n')]
    return out

def plan():
    w = (1850, 1100, 4500, 1900)
    head = ''.join(cell([h], x) for h, x in zip(
        ('*Step*', '*Quarters*', '*Milestones (quantitative metric)*', '*Go/no-go*'), w))
    rows = []
    for i, t in enumerate(G['tasks']):
        m = t['milestones']
        rows.append('<w:tr>' + cell([f"{i + 1}. {t['title']}"], w[0])
            + cell([f"Q{m[0]['q'][0]}–Q{m[-1]['q'][-1]}"], w[1])
            + cell([f"{x['name']}: {' '.join(x['metric'].split())}" for x in m], w[2])
            + cell([t['gonogo']], w[3]) + '</w:tr>')
    b = '<w:{0} w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    borders = ''.join(b.format(e) for e in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{sum(w)}" w:type="dxa"/><w:tblBorders>{borders}'
            '</w:tblBorders><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" '
            'w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'
            + ''.join(f'<w:gridCol w:w="{x}"/>' for x in w)
            + f'</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>{head}</w:tr>{"".join(rows)}</w:tbl>')

def answers():  # the cover sheet's second column, row by row
    org = '   '.join(('☒ ' if t in I['types'] else '☐ ') + t
                     for t in ('For-Profit', 'Non-profit', 'Academia'))
    others = [l for p in team for l in (f"Technical POC Name: {p['name']}",
              f"Organization: {p['organization']}", f"Organization Type: {p['orgtype']}")] or ['None']
    deg = [pi['terminal']] + ([f"Excluded: {pi['excluded']}"] if pi.get('excluded') else [])
    return {2: [topic], 3: [G['title']], 4: [I['name']], 5: [org], 6: [I['uei']],
            7: [f"Name: {pi['name']}, {pi['degrees']}", f"Address: {I['address']}",
                f"Telephone: {pi['phone']}", f"Email: {pi['email']}"],
            8: deg, 9: [pi['eligible']],
            10: [f"Name: {I['admin']['name']}", f"Telephone: {I['admin']['phone']}",
                 f"Email: {I['admin']['email']}"],
            11: others, 12: [G['dates']['summary']]}

def text(b):
    return ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', b))

def fill(x):
    body0 = x.index('<w:body>') + 8
    blocks = re.findall(r'<w:p[ >].*?</w:p>|<w:tbl>.*?</w:tbl>|<w:sectPr.*?</w:sectPr>', x[body0:], re.S)
    cover = next(b for b in blocks if 'Solution Summary Cover Sheet' in text(b))
    rows = re.findall(r'<w:tr[ >].*?</w:tr>', cover, re.S)
    new = cover
    for i, lines in answers().items():
        cells = re.findall(r'<w:tc>.*?</w:tc>', rows[i], re.S)
        w = re.search(r'w:w="(\d+)"', cells[1]).group(1)
        new = new.replace(rows[i], rows[i].replace(cells[1], cell(lines, w)))
    iso = re.findall(r'<w:tc>.*?</w:tc>', rows[1], re.S)[0]
    new = new.replace(iso, re.sub(r'(<w:tcPr>.*?</w:tcPr>).*', lambda m: m.group(1)
        + para(f'*EHI ISO #:* {G["program"]["call"]}', 22, 'left', 0) + '</w:tc>', iso, flags=re.S))
    k = blocks.index(cover)
    brk = next(b for b in blocks if '<w:sectPr' in b and b.startswith('<w:p'))
    title = next(b for b in blocks if text(b).strip() == 'Solution Summary')
    it = items()
    names = {'1': 'Define the problem', '2': 'Explain your solution', '3': 'Present your plan'}
    out = [new, brk, title.replace('w:val="22"', 'w:val="24"'),
           para(f'*EHI Topic Area (Number and Title):* {topic}', jc='left', after=0),
           para(f'*Solution Summary Title:* {G["title"]}', jc='left')]
    for h in '123':
        out.append(para(f'*{h}. {names[h]}*', jc='left', after=40, keep=True))
        out += [para(p) for p in it[h]]
    out.append(plan())
    sect = blocks[-1]
    return x[:body0] + ''.join(out) + sect + '</w:body></w:document>'

src, dst = 'docs/attachment-a.docx', 'out/summary.docx'
with zipfile.ZipFile(src) as z, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as o:
    for n in z.namelist():
        d = z.read(n)
        if n == 'word/document.xml':
            d = fill(d.decode()).encode()
        elif n == 'word/header1.xml':
            d = d.replace(b'&lt;PRIME ORGANIZATION LOGO (optional)&gt;', b'')
        elif n == 'word/footer1.xml':
            d = d.replace(b'<w:t>ISO #</w:t>', f'<w:t>{G["program"]["call"]}</w:t>'.encode())
        elif n == 'docProps/core.xml':  # no author: reviewed blind
            d = re.sub(rb'<(dc:creator|cp:lastModifiedBy)>[^<]*<', rb'<\1><', d)
        o.writestr(n, d)
print(dst)
