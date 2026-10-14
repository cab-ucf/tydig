// The application's components (package.yaml), an `each: investigators`
// item made one per person. checklist.typ lists them; lib/assemble.py puts
// them together. (The editor's Checklist panel expands them the same way.)
#let G = yaml("/grant.yaml")
#let key(p) = lower(p.name.split(" ").last())
#let items = yaml("/package.yaml").items.map(i => if i.at("each", default: none) == "investigators" {
  G.investigators.map(p => i + (id: i.id + "-" + key(p), name: i.name + ": " + p.name, file: i.file.replace("{key}", key(p))))
} else { (i,) }).flatten()
