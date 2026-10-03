<!-- Source: docs/pi-ui/skill/SKILL.md (opt-in wording adapted to the composer capability switch). -->
# pi-ui blocks

pi Desktop turns a fenced code block with the language `pi-ui` into an interactive component
(chart, table, cards…). Other clients show the JSON as-is, so the answer still reads fine there.

````
```pi-ui
{"component":"chart","id":"weekly-active","props":{"title":"周活跃用户","type":"line","x":["W1","W2","W3","W4"],"series":[{"name":"WAU","data":[1200,1350,1310,1580]}],"unit":"人"}}
```
````

## When to use it

This capability is **switched on by the user** in pi Desktop's composer (Tools → pi-ui) for this
conversation. It stays in your instructions only while the switch is on; when it is off you will not
see this section and must not write pi-ui blocks. Blocks only render in pi Desktop; in a terminal or
any other client they show up as raw JSON.

- **On** → the user is happy to get visual answers. Use a block when the data in the request has a
  shape worth drawing (series, rankings, comparisons with numbers, timelines, decisions). If nothing
  does, answer in prose — don't force a block.
- Prefer one well-chosen block over several; keep the prose around it short.

Even when it is on, don't use a block for:

- explanations, opinions, how-tos, single numbers, short lists (≤3 items) — plain Markdown;
- code to copy or run — a normal ```ts / ```bash fence (`diff` is only for showing a change);
- a small text-only comparison (≤6 rows, no numbers to sort) — a Markdown table is lighter;
- anything that is not your chat answer: files you write, commit messages, tool arguments, PR
  text;
- when the user asked for another format (Markdown table, mermaid, HTML, an image file) — follow
  the user.

One to three blocks per answer is normal. Never wrap the whole answer in blocks.

## How a good answer looks

1. **Gather the data first** (read files, run the command, check the conversation). Never emit a
   block with placeholder or invented numbers; estimates are labelled in `title` or `note`.
2. **Lead sentence**: the takeaway in one line, so the answer makes sense without the visual.
3. **The block**, at the top level of the Markdown (not inside a list, quote or another fence).
4. **2–4 bullets after it**: what stands out, caveats, next step. Don't re-list every number the
   block already shows.

## Pick a component

| Data shape | Component |
|---|---|
| A few headline numbers, with change vs. last period | `stat-grid` |
| Values over time / across categories | `chart` `line` / `bar` / `area` |
| Ranking, long category names | `chart` `horizontal-bar` |
| Share of a whole (≤8 slices) | `chart` `donut` / `pie` |
| Two measures with different units | `chart` bars + a `line` series on `axis: "right"` |
| Many rows, several columns to sort or search | `data-table` |
| Links, articles, repos, options with a summary | `card-grid` |
| What changed between two versions of a text | `diff` |
| Troubleshooting or "which option fits me" | `decision-tree` |
| Checking understanding, practice questions | `quiz` |
| Plan, schedule, roadmap with dates | `gantt` |

## JSON rules

1. **One strict JSON object per fence**: double quotes, no comments, no trailing commas. The fence
   language is exactly `pi-ui` (not `json`).
2. **Envelope**: `component` (required), `id` (short kebab-case, unique within the answer),
   `props` (required object). `version` is optional.
3. Strings are plain text — no Markdown inside. Use `\n` for line breaks.
4. Chart data are JSON numbers (`1200`, not `"1,200"` or `"12%"`; `null` = gap); put the unit in
   `unit`. stat-grid `value` is a display string (`"¥1.28M"`).
5. Labels in the user's language. Keep blocks compact — the JSON is streamed token by token;
   aggregate large data instead of pasting hundreds of rows.
6. Unknown fields are ignored. Invalid props show a small fallback with the source — fix the JSON
   rather than repeating it.

## Components (props)

`?` = optional. Limits are hard caps; stay well below them.

### stat-grid — KPI cards (≤24 items)
`title?`, `periods?: string[]` (x labels for history), `items: [{ label, value: string, unit?,
delta?: "+12.4%", trend?: "up"|"down"|"flat", note?, history?: number[] }]`
The arrow follows the delta's sign; `trend` sets the colour — `"up"` = good (green), `"down"` =
bad (red) — so a falling churn rate is `"delta": "-0.6pt", "trend": "up"`. Omit `trend` when the
sign already means good/bad. `history` draws a sparkline.

### chart — SVG chart
`title?`, `type: "line"|"bar"|"area"|"horizontal-bar"|"pie"|"donut"|"scatter"`, `x?: string[]`
(category labels; for scatter numeric strings), `series: [{ name, data: (number|null)[],
type?: "line"|"bar"|"area", axis?: "left"|"right" }]` (1–12 series, ≤500 points), `unit?`,
`rightUnit?`, `stacked?: boolean`, `height?: 160–420`.
- Mixed charts: set a per-series `type` (e.g. bars + a line on `axis: "right"`).
- Pie/donut: one series with `x` labels, or several series with one value each.

### data-table — sortable, searchable, paged, CSV export
`title?`, `columns?: [{ key, label?, type?: "string"|"number"|"date"|"boolean" }]`,
`rows: object[]` (≤2000), `pageSize?: 5–100` (default 10). Columns are inferred from the first
row when omitted; give `columns` to control order, labels and numeric alignment.

### card-grid — link / item cards (≤60)
`title?`, `items: [{ title, summary?, tag?, source?, url? }]`. `url` must be http(s). Two or more
distinct tags add a filter.

### diff — before/after text
`title?`, `before: string`, `after: string`, `language?`, `beforeLabel?`, `afterLabel?`.
Unified/split views, word-level highlights, unchanged runs folded.

### decision-tree — step-by-step guided flow (≤200 nodes)
`title?`, `start?: nodeId` (default first node), `nodes: [{ id, text, detail?, options?: [{ label,
next: nodeId }] }]`. A node without `options` is a conclusion. Every `next` must exist.

### quiz — multiple choice with feedback (≤50 questions)
`title?`, `mode?: "list"|"step"` (default: list for ≤3 questions, else one at a time),
`questions: [{ question, options: string[2–10], answer?, explanation? }]`.
`answer` = 0-based index, the exact option text, or an array of them for multi-select. Omit
`answer` for opinion/survey questions. Don't prefix options with "A." — letters are added.

### gantt — schedule / roadmap (≤200 tasks)
`title?`, `today?: "YYYY-MM-DD"`, `scale?: "day"|"week"|"month"` (auto by span), `tasks: [{ id?,
name, start: "YYYY-MM-DD", end?: "YYYY-MM-DD" (inclusive), duration?: days, progress?: 0–1 or
0–100, group?, dependsOn?: id | id[], milestone?: boolean }]`.
Give either `end` or `duration` (default 1 day). A milestone is a single date. Tasks sharing a
`group` are collapsible; `dependsOn` draws arrows.

## Examples

Short answers showing the shape. The numbers stand for data you already have from the
conversation or tool output. [examples.md](examples.md) has one full block per component.

### "把刚才的 benchmark 结果画出来" — ranking

5 次取中位数，esbuild 最快，比 webpack 快约 19 倍：

```pi-ui
{"component":"chart","id":"cold-start","props":{"title":"冷启动耗时（中位数，5 次）","type":"horizontal-bar","x":["esbuild","Vite","Rspack","webpack"],"series":[{"name":"耗时","data":[0.41,1.2,1.9,7.8]}],"unit":"s"}}
```

- Vite 和 Rspack 差距不大，选型时可以更看重插件生态。
- 测试机是本地 SSD，CI 上的绝对值会更高，但排序应当一致。

### "总结一下这次测试跑得怎么样" — KPIs

测试全部通过，但耗时比上次多了 18%，主要来自新增的集成测试：

```pi-ui
{"component":"stat-grid","id":"test-run","props":{"items":[{"label":"通过","value":"1,385","delta":"+12"},{"label":"失败","value":"0","delta":"-2","trend":"up"},{"label":"耗时","value":"94","unit":"s","delta":"+18%","trend":"down"},{"label":"覆盖率","value":"81.2","unit":"%","delta":"+0.6pt"}]}}
```

### "对比一下这几个日期库" — several attributes

如果只需要格式化和加减，date-fns 体积最小；需要时区再看 Luxon：

```pi-ui
{"component":"data-table","id":"date-libs","props":{"columns":[{"key":"name","label":"库"},{"key":"kb","label":"体积 (KB, gzip)","type":"number"},{"key":"tz","label":"内置时区","type":"boolean"},{"key":"immutable","label":"不可变","type":"boolean"}],"rows":[{"name":"date-fns","kb":6.9,"tz":false,"immutable":true},{"name":"Day.js","kb":2.9,"tz":false,"immutable":true},{"name":"Luxon","kb":23.4,"tz":true,"immutable":true},{"name":"Moment","kb":72.1,"tz":false,"immutable":false}]}}
```

### "这个函数你改了什么" — a change

只改了重试逻辑：次数可配置、失败之间加退避、最后抛错而不是返回 `undefined`：

```pi-ui
{"component":"diff","id":"retry-change","props":{"language":"ts","before":"async function fetchWithRetry(url) {\n  for (let i = 0; i < 3; i++) {\n    const res = await fetch(url)\n    if (res.ok) return res\n  }\n}","after":"async function fetchWithRetry(url, attempts = 3) {\n  for (let i = 0; i < attempts; i++) {\n    const res = await fetch(url)\n    if (res.ok) return res\n    await sleep(2 ** i * 200)\n  }\n  throw new Error(`failed after ${attempts} attempts`)\n}"}}
```

### "useEffect 和 useLayoutEffect 有什么区别" — no block

A conceptual question: answer in prose with a short code example. A chart or table would add
nothing here.

## Before sending

- Data came from the conversation or tools, not made up.
- The fence says `pi-ui`, the JSON is strict, every `id` is unique in the answer.
- A lead sentence comes before the block and a few takeaways after it.
