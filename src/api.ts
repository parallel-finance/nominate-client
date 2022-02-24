import '@polkadot/api-augment'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { options } from '@parallel-finance/api'

export const onDisconnectedOrError = (): void => process.exit(1)

export const connect = async (
	relayWs: string,
	paraWs: string
): Promise<{ relayApi: ApiPromise; paraApi: ApiPromise }> => {
	const relayApi = await ApiPromise.create({
		provider: new WsProvider(relayWs)
	})

	const paraApi = await ApiPromise.create(
		options({ provider: new WsProvider(paraWs) })
	)

	relayApi.on('disconnected', onDisconnectedOrError)
	paraApi.on('disconnected', onDisconnectedOrError)

	return { relayApi, paraApi }
}
