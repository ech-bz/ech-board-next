import { cva } from 'class-variance-authority'
import { MasterKeyView } from './MasterKeyView'
import { UserView } from './UserView'

const pageVariants = cva('max-w-settings p-6')
const separatorVariants = cva('my-8 h-px bg-separator')

export function AccountView() {
  return (
    <div class={pageVariants()}>
      <UserView />
      <div class={separatorVariants()} />
      <MasterKeyView />
    </div>
  )
}
