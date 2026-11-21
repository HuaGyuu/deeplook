import { API_ORIGIN } from './api/client.js'

export type BalanceInfo = {
  currency?: string
  total_balance?: string
  granted_balance?: string
  topped_up_balance?: string
}

export type BalanceResponse = {
  is_available?: boolean
  balance_infos?: BalanceInfo[]
}

/** 查询 DeepSeek 账户余额（官方接口 GET /user/balance）。 */
export const fetchBalance = async (apiKey: string, signal?: AbortSignal): Promise<BalanceResponse> => {
  const response = await fetch(`${API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      Accept: 'application/json',
    },
    signal,
  })
  if (!response.ok) {
    throw new Error(`balance HTTP ${response.status}`)
  }
  return (await response.json()) as BalanceResponse
}

