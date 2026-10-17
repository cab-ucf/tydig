# out/full.pdf: the whole application, in package.yaml's order, opened by the
# checklist and with a page marking each required component still missing.
import glob, json, os, subprocess
from pypdf import PdfReader, PdfWriter

typst = os.environ.get('TYPST', 'typst')
def run(*a): return subprocess.run([typst, *a], capture_output=True, text=True, check=True).stdout
# built, but blank (letters.typ without letters): not there
def blank(f): return f.startswith('out/') and f.endswith('.pdf') and not any(
    p.extract_text().strip() for p in PdfReader(f).pages)
items = json.loads(run('eval', 'import "/lib/package.typ": items; items', '--in', 'main.typ'))
have = {i['id']: sorted(f for f in glob.glob(i['file']) if not blank(f)) for i in items if i.get('file')}
os.makedirs('build', exist_ok=True)
run('compile', '--input', 'present=' + json.dumps([k for k, v in have.items() if v]), 'checklist.typ', 'build/checklist.pdf')
out = PdfWriter()
out.append('build/checklist.pdf')
for i in items:
    if not i.get('file') or i.get('before'): continue  # a form online, or sent before (a concept outline)
    for f in have[i['id']]:
        if f.endswith('.pdf'): out.append(f)  # a spreadsheet (the COA) goes up as it is
    if not have[i['id']] and i.get('when', 'always') == 'always':
        run('compile', '--input', f"name={i['name']}", '--input', f"from={i.get('from', 'build it: make')}", 'lib/missing.typ', f"build/missing-{i['id']}.pdf")
        out.append(f"build/missing-{i['id']}.pdf")
out.write('out/full.pdf')
print('out/full.pdf:', len(out.pages), 'pages;', 'missing:', ', '.join(i['name'] for i in items
  if i.get('file') and not have[i['id']] and i.get('when', 'always') == 'always') or 'nothing')
