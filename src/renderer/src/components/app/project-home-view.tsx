export function ProjectHomeView({
  projectName,
  subtitle,
}: {
  projectName?: string
  subtitle?: string
}) {
  return (
    <div className="project-home-view absolute inset-0 flex flex-col items-center justify-center px-8 transition-all duration-[var(--motion-slow)] ease-[var(--motion-ease)]">
      <div className="-translate-y-[8rem] text-center">
        <h2 className="text-[22px] font-semibold text-foreground">
          {projectName ? `要在 ${projectName} 中做什么？` : '准备开始什么？'}
        </h2>
        <p className="mt-2 text-[13px] text-foreground-secondary/70">
          {subtitle || '输入消息开始新对话，或从左侧选择历史会话'}
        </p>
      </div>
    </div>
  )
}
