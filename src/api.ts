import { ApiPromise, WsProvider } from '@polkadot/api'
import jsonrpc from '@polkadot/types/interfaces/jsonrpc'
import { rpc, types, typesAlias } from './config/types.json'

export const connect = async (relayWs: string, paraWs: string) => {
	const relayApi = await ApiPromise.create({
		provider: new WsProvider(relayWs)
	})

	const paraApi = await ApiPromise.create({
		provider: new WsProvider(paraWs),
		types,
		typesAlias,
		rpc: { ...jsonrpc, ...rpc }
	})

	return { relayApi, paraApi }
}
