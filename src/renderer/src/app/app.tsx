import { Sidebar, SidebarContent, SidebarHeader, SidebarItem } from '@renderer/components/ui/sidebar'
import { PanelTabs } from '@renderer/components/app/panel-tabs'
import { Timeline } from '@renderer/components/app/timeline'
import { Composer } from '@renderer/components/app/composer'
import { TopBar } from '@renderer/components/app/top-bar'

export default function App() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar>
          <SidebarHeader label="pi Desktop" />
          <SidebarContent>
            <SidebarItem label="会话列表" active />
            <SidebarItem label="设置" />
          </SidebarContent>
        </Sidebar>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Timeline />
          <Composer />
        </div>
        <PanelTabs />
      </div>
    </div>
  )
}
