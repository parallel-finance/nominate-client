import { ApiPromise, WsProvider } from '@polkadot/api'
import jsonrpc from '@polkadot/types/interfaces/jsonrpc'
import { rpc, types, typesAlias } from './config/types.json'

export const onDisconnectedOrError = (): void => process.exit(1)

export const connect = async (
	relayWs: string,
	paraWs: string
): Promise<{ relayApi: ApiPromise; paraApi: ApiPromise }> => {
	const relayApi = await ApiPromise.create({
		provider: new WsProvider(relayWs)
	})

	const paraApi = await ApiPromise.create({
		provider: new WsProvider(paraWs),
		types,
		typesAlias,
		rpc: { ...jsonrpc, ...rpc }
	})

	relayApi.on('disconnected', onDisconnectedOrError)
	paraApi.on('disconnected', onDisconnectedOrError)

	return { relayApi, paraApi }
}
