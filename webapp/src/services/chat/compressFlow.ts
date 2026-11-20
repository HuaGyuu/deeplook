import { compressSession } from './compress.js'
import { createCompressedSession } from './store.js'
import type { Session } from './types.js'

/** 压缩当前会话并用摘要开启新会话；返回是否成功。 */
export const compressToNewChat = async (session: Session, title: string): Promise<boolean> => {
  const summary = await compressSession(session)
  if (!summary.trim()) {
    return false
  }
  createCompressedSession(title, summary)
  return true
}
