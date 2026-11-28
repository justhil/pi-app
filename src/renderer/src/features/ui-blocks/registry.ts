import { cardGridDefinition } from './components/card-grid'
import { chartDefinition } from './components/chart'
import { dataTableDefinition } from './components/data-table'
import { decisionTreeDefinition } from './components/decision-tree'
import { diffDefinition } from './components/diff'
import { functionPlotDefinition } from './components/function-plot'
import { ganttDefinition } from './components/gantt'
import { imageGalleryDefinition } from './components/image-gallery'
import { quizDefinition } from './components/quiz'
import { statGridDefinition } from './components/stat-grid'
import type { UIBlockDefinition } from './types'

const definitions = [
  statGridDefinition,
  cardGridDefinition,
  dataTableDefinition,
  chartDefinition,
  functionPlotDefinition,
  imageGalleryDefinition,
  diffDefinition,
  decisionTreeDefinition,
  quizDefinition,
  ganttDefinition,
] as UIBlockDefinition<unknown>[]

/** Component name → definition. Lives in the lazy runtime chunk with every component. */
export const UI_BLOCK_REGISTRY: ReadonlyMap<string, UIBlockDefinition<unknown>> = new Map(
  definitions.map((definition) => [definition.name, definition]),
)
