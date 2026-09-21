import { AvailabilityPage } from '../AvailabilityPage'
import { ConsoleLayout } from './ConsoleLayout'
import { P } from '../../i18n'

export function ChannelsPage({ path }: { path: string }) {
  return (
    <ConsoleLayout path={path} title={P('服务状态')} subtitle={P('查看模型最近实测结果。')}>
      <div className="console-availability">
        <AvailabilityPage />
      </div>
    </ConsoleLayout>
  )
}
