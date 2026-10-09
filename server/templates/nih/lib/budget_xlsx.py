# out/budget.xlsx, from the budget lib/budget.typ computes. With budget.yaml
# excel: (your institution's template and a map of its cells), the numbers
# go into that workbook, which keeps its own formulas and formatting;
# without, a plain workbook whose totals are live formulas.
import json, os, subprocess
from openpyxl import Workbook, load_workbook

typst = os.environ.get('TYPST', 'typst')
b = json.loads(subprocess.run([typst, 'eval', 'import "/lib/budget.typ": budget; budget', '--in', 'main.typ'],
                              capture_output=True, text=True, check=True).stdout)
x = b.get('excel') or {}
def at(path):  # "direct.0", "personnel.Ada Lovelace.salary.1": numbers by index, people by name
    v = b
    for k in path.split('.'):
        v = v[int(k)] if k.isdigit() else next(p for p in v if p.get('name') == k) if isinstance(v, list) else v[k]
    return round(v, 2) if isinstance(v, float) else v

if x.get('template'):
    wb = load_workbook(x['template'])
    for ref, path in x.get('cells', {}).items():
        sheet, cell = ref.split('!')
        wb[sheet][cell] = at(path)
else:
    wb = Workbook(); ws = wb.active; ws.title = 'Budget'
    n = b['years']; col = lambda y: chr(ord('B') + y)
    ws.append(['', *[f'Year {y + 1}' for y in range(n)], 'Total'])
    def row(label, vals):
        ws.append([label, *[round(v, 2) for v in vals]]); r = ws.max_row
        ws.cell(r, n + 2, f'=SUM(B{r}:{col(n - 1)}{r})'); return r
    first = ws.max_row + 1
    for p in b['personnel']:
        row(f"{p['name']}: salary", p['salary']); row(f"{p['name']}: fringe", p['fringe'])
    for o in b['other']: row(o['item'], o['cost'])
    last = ws.max_row
    ws.append(['Direct costs', *[f'=SUM({col(y)}{first}:{col(y)}{last})' for y in range(n + 1)]]); d = ws.max_row
    row('F&A', b['fa'])
    ws.append(['Total', *[f'={col(y)}{d}+{col(y)}{d + 1}' for y in range(n + 1)]])
    row('NIH modules ($25,000 of direct costs)', b['modules'])
    ws.column_dimensions['A'].width = 42
os.makedirs('out', exist_ok=True)
wb.save('out/budget.xlsx')
print('out/budget.xlsx' + (f" (from {x['template']})" if x.get('template') else ''))
