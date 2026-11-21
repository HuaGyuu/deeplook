import { create } from 'zustand'

/** 语音通话浮层：与聊天共用同一会话，只是界面被通话页盖住 */
export const useVoiceCall = create<{ open: boolean }>(() => ({ open: false }))

export const openVoiceCall = () => useVoiceCall.setState({ open: true })
export const closeVoiceCall = () => useVoiceCall.setState({ open: false })
