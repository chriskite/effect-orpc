import { RPCHandler } from '@orpc/server/message-port'
import { router } from './routers'

const handler = new RPCHandler(router)

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    handler.upgrade(port)
  })
})
