// Model routers: desktop-defined virtual models (pi ≥ 0.99). Each router is registered as
// `router/<id>`; for every request it picks a physical model, optionally asking a classifier
// (e.g. TypeSafe Jev) which branch the user's message belongs to.
// Stored in <agentDir>/pi-desktop-routers.json, edited on the "Model routing" settings page.

export const ROUTER_PROVIDER = 'router'
export const ROUTERS_FILE = 'pi-desktop-routers.json'
export const ROUTER_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type RouterThinking = (typeof ROUTER_THINKING_LEVELS)[number] | 'inherit'

/** A physical model as `provider/modelId` plus the thinking level to send it with. */
export interface RouteTarget {
  model: string
  /** `inherit` passes the level selected for the virtual model through. */
  thinking: RouterThinking
}

export interface RouterBranch extends RouteTarget {
  /** Choice name the classifier answers with, e.g. `complex`. */
  label: string
  /** What belongs to this branch, given to the classifier. */
  criteria: string
}

export interface ModelRouter {
  id: string
  name: string
  enabled: boolean
  /** `provider/modelId` of a classifier model; empty routes every session to `fallback`. */
  classifier: string
  /** The question the classifier answers about the user's message. */
  question: string
  branches: RouterBranch[]
  /** Used without a classifier, when classification fails, and for requests outside the agent loop. */
  fallback: RouteTarget
  /** Classify every user message instead of only the first one of a session (switching models loses the prompt cache). */
  classifyEachMessage: boolean
  /** After the first successful edit/write of a turn, switch once to this model for the rest of the session. */
  afterEdit: RouteTarget | null
  /** A failed request is retried on this model instead of the same one. */
  retryOn: RouteTarget | null
}

export interface ModelRoutersFile {
  routers: ModelRouter[]
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const LABEL = /^[A-Za-z0-9_-]{1,40}$/
const MODEL = /^[^/\s]+\/\S+$/

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function target(v: unknown): RouteTarget | null {
  if (!isObj(v)) return null
  const model = str(v.model, 300)
  if (!MODEL.test(model)) return null
  const thinking = (ROUTER_THINKING_LEVELS as readonly string[]).includes(String(v.thinking)) ? (v.thinking as RouterThinking) : 'inherit'
  return { model, thinking }
}

export function defaultRouter(id = 'auto'): ModelRouter {
  return {
    id,
    name: 'Auto',
    enabled: true,
    classifier: 'typesafe/jev-latest',
    question: 'How demanding is the software engineering work requested in `prompt`?',
    branches: [
      { label: 'complex', criteria: 'Subtle design, cross-cutting changes, or hard debugging', model: '', thinking: 'high' },
      { label: 'standard', criteria: 'Ordinary features, fixes, reviews, or questions', model: '', thinking: 'medium' },
    ],
    fallback: { model: '', thinking: 'inherit' },
    classifyEachMessage: false,
    afterEdit: null,
    retryOn: null,
  }
}

/** Valid routers from untrusted JSON, plus what was wrong with the rest. */
export function normalizeRouters(raw: unknown): { routers: ModelRouter[]; problems: string[] } {
  const list = isObj(raw) && Array.isArray(raw.routers) ? raw.routers : []
  const routers: ModelRouter[] = []
  const problems: string[] = []
  const ids = new Set<string>()
  for (const [i, r] of list.entries()) {
    if (!isObj(r)) {
      problems.push(`routers[${i}]: not an object`)
      continue
    }
    const id = str(r.id, 40)
    const where = id || `routers[${i}]`
    if (!ID.test(id)) {
      problems.push(`${where}: id must be lowercase letters, digits and -`)
      continue
    }
    if (ids.has(id)) {
      problems.push(`${id}: duplicate id`)
      continue
    }
    const fallback = target(r.fallback)
    if (!fallback) {
      problems.push(`${id}: fallback needs a provider/model`)
      continue
    }
    const branches: RouterBranch[] = []
    for (const b of Array.isArray(r.branches) ? r.branches : []) {
      const t = target(b)
      const label = isObj(b) ? str(b.label, 40) : ''
      if (t && LABEL.test(label) && !branches.some((x) => x.label === label)) branches.push({ label, criteria: str((b as Record<string, unknown>).criteria, 500), ...t })
    }
    const classifier = str(r.classifier, 300)
    if (classifier && !MODEL.test(classifier)) {
      problems.push(`${id}: classifier must be provider/model`)
      continue
    }
    if (classifier && branches.length < 2) {
      problems.push(`${id}: a classifier needs at least two branches with a model`)
      continue
    }
    ids.add(id)
    routers.push({
      id,
      name: str(r.name, 80) || id,
      enabled: r.enabled !== false,
      classifier,
      question: str(r.question, 1000) || defaultRouter().question,
      branches,
      fallback,
      classifyEachMessage: r.classifyEachMessage === true,
      afterEdit: target(r.afterEdit),
      retryOn: target(r.retryOn),
    })
  }
  return { routers, problems }
}

export function splitModelKey(key: string): { provider: string; id: string } {
  const at = key.indexOf('/')
  return { provider: key.slice(0, at), id: key.slice(at + 1) }
}
