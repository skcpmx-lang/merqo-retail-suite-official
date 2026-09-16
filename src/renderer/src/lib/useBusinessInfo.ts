import { useMemo } from 'react'
import { useSession } from '@/state/session'
import type { BizInfo } from '@/lib/printing'

/** Current business as print-template header info. */
export function useBusinessInfo(): { info: BizInfo } {
  const { business } = useSession()
  const info = useMemo<BizInfo>(() => ({
    name: business?.name ?? '',
    owner_name: business?.owner_name,
    phone: business?.phone,
    address: business?.address,
    email: null,
    logo_data: business?.logo_data ?? null
  }), [business])
  return { info }
}
