import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import {
  finishMobileSiderDrag,
  setMobileSiderDrag,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'

/** 窄于 768px 按移动端布局 */
const query = window.matchMedia('not all and (min-width: 768px)')

const subscribe = (onChange: () => void) => {
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useIsMobile = () => useSyncExternalStore(subscribe, () => query.matches)

const preventPageScroll = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    return
  }
  const target = event.target instanceof Element ? event.target : null
  // 表单控件与滑杆需要自己处理触摸（拖动滑块、选择文本等），不能被整页滚动拦截
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) {
    return
  }
  for (
    let element = target;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element)
    const scrollsY =
      /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth
    if (scrollsY || scrollsX) {
      return
    }
  }
  event.preventDefault()
}

/** 阻止移动端整页滚动，保留内部可滚动区域的滚动和双指缩放。 */
export const usePreventPageScroll = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    document.addEventListener('touchmove', preventPageScroll, { passive: false })
    return () => document.removeEventListener('touchmove', preventPageScroll)
  }, [enabled])
}

/** 移动端页面跟随视觉视口，键盘弹出后顶栏和输入框仍留在可见区域。 */
export const useMobileViewport = (enabled: boolean) => {
  const frameRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      return
    }
    const viewport = window.visualViewport
    const inputSelector = 'textarea, input:not([type="file"])'
    let animationFrame = 0
    const reset = () => {
      frame.style.removeProperty('--app-viewport-height')
      frame.style.removeProperty('--app-viewport-top')
    }
    const update = () => {
      // 双指缩放由浏览器处理，保持当前布局尺寸。
      if (viewport && viewport.scale !== 1) {
        return
      }
      // 失焦后直接恢复 CSS 的全高布局，不等 Safari 收键盘后的 resize。
      if (!document.activeElement?.matches(inputSelector)) {
        reset()
        return
      }
      frame.style.setProperty(
        '--app-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`
      )
      frame.style.setProperty('--app-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    const scheduleFrame = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(update)
    }
    const schedule = () => {
      // 先同步跟上键盘动画，下一帧再校准 Safari 延迟更新的视口读数。
      update()
      scheduleFrame()
    }
    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    // 等点击和焦点切换完成，避免按钮移动、或切换输入框时短暂恢复全高。
    document.addEventListener('focusout', scheduleFrame)
    return () => {
      cancelAnimationFrame(animationFrame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', scheduleFrame)
      reset()
    }
  }, [enabled])

  return frameRef
}

/**
 * 移动端手势：向右滑打开左侧边栏，向左滑关闭。
 * 拖动过程中抽屉按手指位移实时跟随（progress 0→1），松手后再决定展开或收起；
 * 跳过代码块/表格/输入框等可横向滚动的区域，避免和它们抢手势。
 */
export const useSwipeSider = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    let startX = 0
    let startY = 0
    let tracking = false
    let ignore = false
    let direction: 'open' | 'close' | null = null
    /** 抽屉宽度，用于把像素位移换算成 0..1 的进度 */
    const drawerWidth = () => {
      const width = Math.min(300, window.innerWidth - 48)
      return width > 0 ? width : 1
    }
    const shouldIgnore = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        'pre, code, table, textarea, input, [contenteditable="true"], [data-swipe-ignore]'
      ) !== null

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = false
        return
      }
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      tracking = true
      direction = null
      ignore =
        document.querySelector('[role="dialog"]') !== null || shouldIgnore(event.target)
    }
    const onMove = (event: TouchEvent) => {
      if (!tracking || ignore || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!direction) {
        // 位移太小或明显是纵向滚动时先不接管手势
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          return
        }
        const open = useMobileSider.getState().open
        if (dx > 0 && !open) {
          direction = 'open'
        } else if (dx < 0 && open) {
          direction = 'close'
        } else {
          tracking = false
          return
        }
      }
      const distance = dx / drawerWidth()
      const progress =
        direction === 'open'
          ? Math.min(1, Math.max(0, distance))
          : Math.min(1, Math.max(0, 1 + distance))
      setMobileSiderDrag(progress)
    }
    const onEnd = () => {
      if (!tracking) {
        return
      }
      tracking = false
      if (!direction) {
        return
      }
      const { progress } = useMobileSider.getState()
      // 打开超过 40% 或收起剩余不足 60% 就完成动作，否则回到原状态
      finishMobileSiderDrag(direction === 'open' ? progress >= 0.4 : progress > 0.6)
      direction = null
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])
}
