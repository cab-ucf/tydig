// tydig-docx's prelude: what HTML export would drop keeps its content, and
// citations and the bibliography are tagged for endnote.lua.
#show selector.or(align, place, pad, move, scale, rotate, columns): it => it.body
#show rect: it => if it.body != none { it.body }
#show stack: it => it.children.filter(c => type(c) == content).join(parbreak())
#show grid: it => table(columns: it.columns, ..it.children.map(c => c.body))
#show cite: it => html.elem("span", attrs: (data-cite: str(it.key)), [#it#if it.supplement != none {
  html.elem("span", attrs: (data-suffix: ""), it.supplement) }])
#show bibliography: it => html.elem("div", attrs: (data-reflist: ""), it)
