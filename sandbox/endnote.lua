-- Citations as live EndNote fields (ADDIN EN.CITE), each carrying its whole
-- record from the .bib, so the document is its own EndNote "traveling
-- library"; the bibliography as EndNote's (ADDIN EN.REFLIST). Until EndNote
-- updates them, each shows what Typst set. Input: tydig-docx's HTML.
local refs, num, n = {}, {}, 0
local S = pandoc.utils.stringify

local function esc(s)
  return (s:gsub('[&<>"]', { ['&'] = '&amp;', ['<'] = '&lt;', ['>'] = '&gt;', ['"'] = '&quot;' }))
end
local function tag(t, v) return v and v ~= '' and ('<%s>%s</%s>'):format(t, esc(v), t) or '' end
local function f(r, k) return r[k] and S(r[k]) or nil end
local function year(r) return (f(r, 'issued') or ''):match('%d%d%d%d') or '' end
local function who(p) return p.family and S(p.family) .. (p.given and ', ' .. S(p.given) or '') or S(p.literal or p) end
local function names(l)
  local out = {}
  for _, p in ipairs(l or {}) do out[#out + 1] = tag('author', who(p)) end
  return table.concat(out)
end

-- CSL type: EndNote's reference type
local TYPE = { ['article-journal'] = { 17, 'Journal Article' }, book = { 6, 'Book' },
  chapter = { 5, 'Book Section' }, ['paper-conference'] = { 47, 'Conference Paper' },
  report = { 27, 'Report' }, thesis = { 32, 'Thesis' }, webpage = { 12, 'Web Page' } }

local function record(r, i)
  local t, box = TYPE[f(r, 'type')] or { 13, 'Generic' }, f(r, 'container-title')
  return '<record><rec-number>' .. i .. '</rec-number>'
    .. ('<ref-type name="%s">%d</ref-type>'):format(t[2], t[1])
    .. '<contributors><authors>' .. names(r.author) .. '</authors>'
    .. (r.editor and '<secondary-authors>' .. names(r.editor) .. '</secondary-authors>' or '')
    .. '</contributors><titles>' .. tag('title', f(r, 'title')) .. tag('secondary-title', box) .. '</titles>'
    .. (t[1] == 17 and box and '<periodical>' .. tag('full-title', box) .. '</periodical>' or '')
    .. tag('pages', f(r, 'page')) .. tag('volume', f(r, 'volume')) .. tag('number', f(r, 'issue'))
    .. tag('edition', f(r, 'edition')) .. '<dates>' .. tag('year', year(r)) .. '</dates>'
    .. tag('pub-location', f(r, 'publisher-place')) .. tag('publisher', f(r, 'publisher'))
    .. tag('isbn', f(r, 'isbn') or f(r, 'issn')) .. tag('electronic-resource-num', f(r, 'doi'))
    .. tag('abstract', f(r, 'abstract'))
    .. (f(r, 'url') and '<urls><related-urls>' .. tag('url', f(r, 'url')) .. '</related-urls></urls>' or '')
    .. '</record>'
end

-- a Word field: begin, its code, then what it shows, then end
local function raw(x) return pandoc.RawInline('openxml', x) end
local function open(code)
  return raw('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> '
    .. esc(code) .. ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>')
end
local close = raw('<w:r><w:fldChar w:fldCharType="end"/></w:r>')

-- pandoc keeps or drops the data- of an HTML attribute, by element
local function attr(x, k) return x.attributes[k] or x.attributes['data-' .. k] end
local function isCite(x) return x and x.t == 'Span' and attr(x, 'cite') end
local unlink = { Link = function(l) return l.content end }

-- @a @b side by side are one field, as EndNote groups them
local function Inlines(xs)
  local out, i = pandoc.Inlines {}, 1
  while i <= #xs do
    if isCite(xs[i]) then
      local shown, cites = pandoc.Inlines {}, {}
      repeat
        local s, suffix = xs[i], nil
        local key = attr(s, 'cite')
        local r = refs[key] or { id = key }
        if not num[key] then n = n + 1; num[key] = n end
        if #cites > 0 then shown:insert(pandoc.Space()) end
        shown:extend(s.content:walk(unlink):walk {
          Span = function(x) if attr(x, 'suffix') then suffix = S(x); return {} end end })
        local a = r.author and r.author[1]
        cites[#cites + 1] = { tag('Author', a and S(a.family or a.literal or a) or key) .. tag('Year', year(r))
          .. '<RecNum>' .. num[key] .. '</RecNum>' .. tag('Suffix', suffix and ', ' .. suffix), record(r, num[key]) }
        local more = xs[i + 1] and xs[i + 1].t == 'Space' and isCite(xs[i + 2])
        i = i + (more and 2 or 1)
      until not more
      local code = {}
      for j, c in ipairs(cites) do code[j] = '<Cite>' .. c[1] .. (j == 1 and tag('DisplayText', S(shown)) or '') .. c[2] .. '</Cite>' end
      out:insert(open('ADDIN EN.CITE <EndNote>' .. table.concat(code) .. '</EndNote>'))
      out:extend(shown); out:insert(close)
    else
      out:insert(xs[i]); i = i + 1
    end
  end
  return out
end

-- the bibliography: its heading stays; its entries, paragraphs in EndNote's field
local function Div(d)
  if not attr(d, 'reflist') then return end
  local blocks, entries = {}, {}
  d:walk {
    Header = function(h) blocks[#blocks + 1] = h end,
    BulletList = function(l) for _, item in ipairs(l.content) do entries[#entries + 1] = pandoc.utils.blocks_to_inlines(item) end end }
  for i, e in ipairs(entries) do
    e = e:walk(unlink)
    if i == 1 then e:insert(1, open('ADDIN EN.REFLIST')) end
    if i == #entries then e:insert(close) end
    blocks[#blocks + 1] = pandoc.Para(e)
  end
  return blocks
end

local function Meta(m)
  for _, b in ipairs(m.bib and (pandoc.utils.type(m.bib) == 'List' and m.bib or { m.bib }) or {}) do
    local h = io.open(S(b))
    if h then
      for _, r in ipairs(pandoc.read(h:read('a'), 'bibtex').meta.references or {}) do refs[S(r.id)] = r end
      h:close()
    end
  end
end

return { { Meta = Meta }, { Inlines = Inlines, Div = Div } }
