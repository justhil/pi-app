import { HomeUsageOverview } from '@renderer/features/usage/home-usage-overview'

export function ProjectHomeView() {
  return (
    <div
      data-independent-scroll=""
      style={{
        paddingBottom:
          'calc(var(--main-col-h, 100vh) * 0.28 + var(--composer-dock-h, 9rem) * 0.5 + 1.25rem)',
      }}
      className="project-home-view overlay-scroll-pane absolute inset-0 flex flex-col items-center justify-end overflow-y-auto px-6 pt-4 sm:px-8"
    >
      <HomeUsageOverview />
    </div>
  )
}
