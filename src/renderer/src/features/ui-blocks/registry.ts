import { cardGridDefinition } from './components/card-grid'
import { chartDefinition } from './components/chart'
import { dataTableDefinition } from './components/data-table'
import { decisionTreeDefinition } from './components/decision-tree'
import { diffDefinition } from './components/diff'
import { ganttDefinition } from './components/gantt'
import { quizDefinition } from './components/quiz'
import { statGridDefinition } from './components/stat-grid'
import type { UIBlockDefinition } from './types'

const definitions = [
  statGridDefinition,
  cardGridDefinition,
  dataTableDefinition,
  chartDefinition,
  diffDefinition,
  decisionTreeDefinition,
  quizDefinition,
  ganttDefinition,
] as UIBlockDefinition<unknown>[]

/** Component name → definition. Lives in the lazy runtime chunk with every component. */
export const UI_BLOCK_REGISTRY: ReadonlyMap<string, UIBlockDefinition<unknown>> = new Map(
  definitions.map((definition) => [definition.name, definition]),
)
