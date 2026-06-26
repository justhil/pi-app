/** 运行中也可切换；后台 Worker 继续当前绑定会话 */
export function guardSessionSwitch(action: () => void): void {
  action()
}