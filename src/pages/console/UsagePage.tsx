import { P } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'
import { UsageRecords } from '../../components/usage/UsageRecords'

export function UsagePage({ path }: { path: string }) {
  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('用量记录')} subtitle={P('把每一份社区资源，用在新的可能上。控制台不提供请求诊断。')} />
      <UsageRecords mode="console" />
    </ConsoleLayout>
  )
}
