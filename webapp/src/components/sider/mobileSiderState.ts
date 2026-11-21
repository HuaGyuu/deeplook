import { create } from 'zustand'

/**
 * 移动端侧边栏抽屉：顶栏菜单按钮打开，点遮罩、切换会话或开启新对话后关闭。
 * dragging/progress 用于手指拖动时抽屉跟随手指移动（0 = 完全收起，1 = 完全打开）。
 */
type MobileSiderState = {
  open: boolean
  dragging: boolean
  progress: number
}

export const useMobileSider = create<MobileSiderState>(() => ({
  open: false,
  dragging: false,
  progress: 0,
}))

export const openMobileSider = () =>
  useMobileSider.setState({ open: true, dragging: false, progress: 1 })

export const closeMobileSider = () =>
  useMobileSider.setState({ open: false, dragging: false, progress: 0 })

/** 拖动中：抽屉按 progress 跟随手指，不做过渡动画 */
export const setMobileSiderDrag = (progress: number) =>
  useMobileSider.setState({ dragging: true, progress })

/** 松手：按最终状态收尾，让 CSS 过渡从当前手指位置继续 */
export const finishMobileSiderDrag = (open: boolean) =>
  useMobileSider.setState({ dragging: false, open, progress: open ? 1 : 0 })
