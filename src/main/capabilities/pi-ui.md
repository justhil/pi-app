<!-- Source: pi-ui V2 compact prompt (inspired by DEEIX-Chat V2 A2UI spec). -->
# pi-ui blocks

<nature>Output format only (never a tool call): emit a `pi-ui` fenced JSON block in chat prose; pi Desktop renders it as an interactive component.</nature>

<when>
- Use when visual/interactive output beats Markdown: KPIs, trends/rankings, math plots, what-if/formula exploration, >6 rows to sort/search, timelines, diffs, decision trees, quizzes, or multi-image galleries.
- Stay in Markdown for prose, ≤3 isolated numbers, copyable code, small text tables, non-chat text (files/commits/PRs), or when the user asked for another format.
- Never invent data (label estimates). Lead with 1 takeaway line, emit 1–3 top-level blocks, then 2–4 short bullets without repeating block data. Pick lightest: catalog component → `panel` (only when controls/state drive live formulas or linked widgets).
</when>

<syntax>
Exact fence language: `pi-ui`. One strict JSON object: `component`, `id` (unique kebab-case), plus props (flat or under `props`). Plain text in strings, JSON numbers in charts (`null`=gap), user's language, and only verified `https://` URLs from context (never fabricate image URLs).
</syntax>

<live>
`panel` supports `state` (initial JSON), `computed` (unbraced formulas, acyclic), and `children` (primitives or catalog components without `id`).
- Templates: `{expr}` evaluates live (sole `{expr}` keeps raw type; mixed formats numbers); `{{`/`}}` literal; `visible: "{cond}"`.
- Exprs: numbers, strings, `+ - * / % ^`, comparisons, `&& || !`, `a?b:c`, `obj.k`, `list[i]`, `[a,b]`, `pi e`, `abs sqrt cbrt floor ceil sign log ln log10 log2 exp sin cos tan asin acos atan sinh cosh tanh pow min max round fixed clamp range sum avg len contains`.
- Per-point: `chart` `series[].data: "{expr(x,i)}"`; `data-table`/`card-grid` `where: "{cond(row,i)}"`.
- Layout: `panel {title?,description?}`, `row`, `stack`, `grid {columns?:1-4}`, `card {title?}`, `tabs {items,bind?}`, `collapse {title,open?}`, `divider`. Flat `panel` children with `scene` auto-split (controls left, scene right, `ask` below).
- Display: `text {text,tone?,size?:sm|base|lg}`, `stat {label,value,unit?,note?,precision?,highlight?,tone?}`, `badge {text,tone?}`, `progress {value,max?,label?,tone?}`, `callout {text,title?,tone?}`, `formula {expr,name?,unit?,precision?,label?,with?}`, `scene {width?,height?,shapes:[{type:rect|circle|line|arrow|text,coords,label?,tone?}]}`.
- Controls (`bind`→state, `tone`: `default|muted|positive|negative|warning|info`, `options`: `string[]|{label,value}[]`): `slider {bind,label,min,max,step?,unit?}`, `select {bind,label,options}`, `segmented {bind,label?,options}`, `switch {bind,label}`, `input {bind,label,type?:text|number,placeholder?}`, `button {label?,ask|set|copy,variant?:default|outline}`.

```pi-ui
{"component":"panel","id":"loan","title":"房贷试算","state":{"amount":100,"years":30},"computed":{"r":"3.5/1200","n":"years*12","m":"amount*10000*r*(1+r)^n/((1+r)^n-1)"},"children":[{"component":"slider","bind":"amount","label":"贷款(万)","min":10,"max":500},{"component":"slider","bind":"years","label":"年限","min":5,"max":30},{"component":"stat","label":"月供","value":"{round(m)}","unit":"元","highlight":true},{"component":"chart","type":"line","x":"{range(1,years)}","series":[{"name":"剩余本金(万)","data":"{amount*((1+r)^n-(1+r)^(x*12))/((1+r)^n-1)}"}]},{"component":"button","ask":"按 {amount} 万、{years} 年对比等额本息与等额本金"}]}
```

```pi-ui
{"component":"panel","id":"fg","title":"重力 F=mg","state":{"m":9,"g":9.8},"children":[{"component":"formula","name":"F_g","expr":"m*g","unit":"N","precision":1},{"component":"slider","bind":"m","label":"质量","min":1,"max":20,"unit":"kg"},{"component":"scene","width":220,"height":170,"shapes":[{"type":"rect","x":70,"y":16,"w":80,"h":42,"label":"{m} kg","tone":"info"},{"type":"arrow","x1":110,"y1":58,"x2":110,"y2":"{58+min(m*g,180)/2}","label":"{round(m*g,1)} N","tone":"negative"}]}]}
```
</live>

<catalog>
- `stat-grid`: `{title?,periods?,items:[{label,value,unit?,delta?,trend?:up|down|flat,tone?:positive|negative|neutral,note?,history?}]}` (≤24; `trend`=arrow, `tone`=good/bad color)
- `chart`: `{title?,type:line|bar|area|horizontal-bar|scatter|pie|donut|radar|funnel|radial,x?,series:[{name,data,type?,axis?:left|right}],unit?,rightUnit?,stacked?,percent?,height?}` (`percent` needs `stacked`)
- `function-plot`: `{title?,functions:[{expr}],x?:[min,max],y?:[min,max]}` (≤8; `y=f(x)`, `x=g(y)`, or `lhs=rhs`, explicit `*`)
- `data-table`: `{title?,columns?:[{key,label?,type?:string|number|date|boolean|image}],rows,pageSize?}` (≤2000)
- `card-grid`: `{title?,items:[{title,summary?,tag?,source?,url?,image?}]}` (≤60)
- `image-gallery`: `{title?,images:[{src,alt?,caption?,source?,url?}]}` (≤30; single image→Markdown)
- `gantt`: `{title?,today?,scale?:day|week|month,tasks:[{id?,name,start,end?,duration?,progress?,group?,dependsOn?,milestone?}]}` (≤200)
- `diff`: `{title?,before,after,language?,beforeLabel?,afterLabel?}`
- `decision-tree`: `{title?,start?,nodes:[{id,text,detail?,options?:[{label,next}]}]}` (≤200; leaf omits `options`)
- `quiz`: `{title?,mode?:list|step,questions:[{id?,question,image?,options:(string|{text,next?,explanation?})[],answer?,explanation?,next?}]}` (≤50; `next:"end"` stops; no "A." prefix)
</catalog>
