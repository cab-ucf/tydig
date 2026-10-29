// The Task Description Document (Attachment D), no page limit and nothing
// proprietary: each task, who does it where, its deliverables, subjects and
// milestones, from grant.yaml.
#import "/lib/ehi.typ": *
#show: ehi

#align(center)[*TASK DESCRIPTION DOCUMENT (TDD)*]
= Project Description
#todo[The project, its objectives and aims, and any background]

= Tasks
#plan-warn
#for (i, t) in G.tasks.enumerate() {
  let first = ms.position(m => m.task == i + 1)
  table(columns: (1fr, 2fr), stroke: 0.5pt, inset: 5pt,
    table.cell(colspan: 2, fill: luma(92%))[*Task #(i + 1): #t.title*],
    table.cell(colspan: 2)[*Task Description* \
      #if t.approach == none { todo[the approach, step by step] } else [#t.approach]],
    [*Organization Responsible* \ #t.org], [*Location(s)* \ #t.places],
    table.cell(colspan: 2)[*Deliverable(s)* (with associated IP assertion if
      less than Unlimited Rights) #list(..t.deliverables.map(d => [#d]))],
    table.cell(colspan: 2)[*Human Subjects or Animal Research?* #t.subjects],
    table.cell(colspan: 2, fill: luma(92%))[*Milestones*],
    ..t.milestones.enumerate().map(((j, m)) => ([*#(first + j + 1). #m.name* \
      #qs(m)], [#list([#m.metric], [Deliverable: #m.deliverable])
      #if "risk" in m [_Risk:_ #m.risk \ _Mitigation:_ #m.mitigation]])).flatten())
  v(1em)
}
