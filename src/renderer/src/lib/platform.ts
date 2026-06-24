const nav = typeof navigator !== 'undefined' ? navigator : undefined

export const isMac = !!nav && /Mac/i.test(nav.platform)
export const isWindows = !!nav && /Win/i.test(nav.platform)
export const isLinux = !!nav && /Linux/i.test(nav.platform)

/** macOS hiddenInset 红绿灯区域占位宽度（与 trafficLightPosition 对齐） */
export const MAC_TRAFFIC_LIGHTS_SPACER_CLASS = 'w-[72px] shrink-0' as const