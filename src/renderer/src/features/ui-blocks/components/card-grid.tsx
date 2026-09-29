import { memo, useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from '@renderer/components/icons'
import { useBlockState } from '../block-state'
import { BlockFrame, Segmented } from '../frame'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'

type CardItem = { title: string; summary?: string; tag?: string; source?: string; url?: string }
type CardGridProps = { title?: string; items: CardItem[] }

const schema = v.object<CardGridProps>({
  title: v.optional(v.string()),
  items: v.array(
    v.object<CardItem>({
      title: v.string(),
      summary: v.optional(v.string()),
      tag: v.optional(v.string()),
      source: v.optional(v.string()),
      url: v.optional(v.string()),
    }),
    { min: 1, max: 60 },
  ),
})

function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined
}

const Card = memo(function Card({ item, index, animate }: { item: CardItem; index: number; animate: boolean }) {
  const href = safeUrl(item.url)
  const body = (
    <>
      <div className="uib-cardgrid-title">{item.title}</div>
      {item.summary ? <p className="uib-cardgrid-summary">{item.summary}</p> : null}
      {item.tag || item.source || href ? (
        <div className="uib-cardgrid-foot">
          {item.tag ? <span className="uib-chip">{item.tag}</span> : null}
          {item.source ? <span className="uib-cardgrid-source">{item.source}</span> : null}
          {href ? <ExternalLink className="uib-cardgrid-link" aria-hidden /> : null}
        </div>
      ) : null}
    </>
  )
  const className = animate ? 'uib-card uib-cardgrid-card uib-stagger' : 'uib-card uib-cardgrid-card'
  const style = { '--i': index } as CSSProperties
  return href ? (
    <a className={className} style={style} href={href} target="_blank" rel="noreferrer" data-link>
      {body}
    </a>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  )
})

function CardGrid({ props, blockKey, animate }: UIBlockComponentProps<CardGridProps>) {
  const { t } = useTranslation()
  const tags = useMemo(
    () => [...new Set(props.items.map((item) => item.tag).filter((tag): tag is string => !!tag))],
    [props.items],
  )
  const [tag, setTag] = useBlockState<string>(blockKey, 'tag', '')
  const visible = tag ? props.items.filter((item) => item.tag === tag) : props.items
  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={
        tags.length > 1 ? (
          <Segmented
            label={t('timeline:uiBlock.filter')}
            value={tag}
            onChange={setTag}
            options={[{ value: '', label: t('timeline:uiBlock.all') }, ...tags.map((value) => ({ value, label: value }))]}
          />
        ) : null
      }
    >
      <div className="uib-cardgrid">
        {visible.map((item, index) => (
          <Card key={`${item.title}-${index}`} item={item} index={index} animate={animate} />
        ))}
      </div>
    </BlockFrame>
  )
}

export const cardGridDefinition: UIBlockDefinition<CardGridProps> = {
  name: 'card-grid',
  schema,
  Component: CardGrid,
  skeleton: 'cards',
}
