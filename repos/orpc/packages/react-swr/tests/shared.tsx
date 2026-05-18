import { orpc as client, streamedOrpc as streamedClient } from '../../client/tests/shared'
import { createSWRUtils } from '../src'

export const orpc = createSWRUtils(client)
export const streamedOrpc = createSWRUtils(streamedClient)
