import { ApiPromise, WsProvider } from '@polkadot/api'
import jsonrpc from '@polkadot/types/interfaces/jsonrpc'
import { types, typesAlias } from './config/types.json'
import { RPC } from './config/rpc.json'

export const connect = async (relayWs: string, paraWs: string) => {
    const relayApi = await ApiPromise.create({
        provider: new WsProvider(relayWs),
    })

    const paraApi = await ApiPromise.create({
        provider: new WsProvider(paraWs),
        types,
        typesAlias,
        rpc: { ...jsonrpc, ...RPC },
    })

    return { relayApi, paraApi }
}
