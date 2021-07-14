import { Command } from 'commander'
import { ApiPromise, WsProvider } from '@polkadot/api'
import types from './config/types.json'
import type { EraIndex, ValidatorPrefs } from '@polkadot/types/interfaces'
import type {
    DeriveEraPoints,
    DeriveEraPrefs,
    DeriveStakingAccount,
} from '@polkadot/api-derive/types'
import type { ValidatorInfo, ValidatorIdentity } from './model'
import { orderBy } from 'lodash'
import { identity } from '@polkadot/types/interfaces/definitions'
import BN from 'bn.js'

const program = new Command()

program
    .name('nominate-client')
    .version('1.0.0.', '-v, --vers', 'output the current version')
    .option(
        '-p, --para-ws <string>',
        'The Parachain API endpoint to connect to.',
        'wss://testnet-rpc.parallel.fi'
    )
    .option(
        '-r, --relay-ws <string>',
        'The Relaychain API endpoint to connect to.',
        'wss://kusama-rpc.polkadot.io'
    )
    .option('-s, --seed <string>', 'The account seed to use')

program.parse()

const options = program.opts()

;(async () => {
    const provider = new WsProvider(options.relayWs)
    const api = await ApiPromise.create({ provider })

    // current validators
    // const validators = await api.derive.staking.validators()
    // const overview = await api.derive.staking.overview()
    // console.log(validators.validators.map((x) => x.toJSON()).length)

    // all validators' stashes accounts
    const stashes = (await api.derive.staking.stashes()).map((x) =>
        x.toString()
    )

    const identities = (
        await api.derive.accounts.hasIdentityMulti(stashes)
    ).map((identity) => ({
        display: identity.display?.toString(),
        hasIdentity: identity.hasIdentity,
    }))

    // commission rate
    let validators: ValidatorInfo[] = (
        await api.derive.staking.accounts(stashes)
    )
        .map((sa, idx) => {
            return {
                accountId: sa.accountId.toString(),
                stashId: sa.stashId.toString(),
                controllerId: sa.controllerId.toString(),
                // nominators: sa.nominators.map((x) => x.toJSON()),
                commissionRate: sa.validatorPrefs.commission.toNumber() / 1e9,
                blocked: sa.validatorPrefs.blocked.toJSON(),
                identity: identities[idx],
            }
        })
        // Testing
        .filter(
            (v) => v.identity.hasIdentity && v.identity.display && !v.blocked
        )

    const currentEra = await api.query.staking.currentEra()
    const allEras = await api.derive.staking?.erasHistoric(false)
    const weekEras = allEras.slice(-28)
    const slashes = await Promise.all(
        weekEras.map(async (eraIndex) => {
            return await api.derive.staking.eraSlashes(eraIndex)
        })
    )

    // todo switch to api.derive.staking.erasPointss
    const erasPointss = await api.derive.staking._erasPoints(weekEras, false)

    const calculateAvgEraPoints = (
        address: string,
        erasPointss: DeriveEraPoints[]
    ): number => {
        return erasPointss.reduce(
            (ite, cur) => ite + cur.validators[address]?.toNumber() || 0,
            0
        )
    }

    const calculateAvgEraPointsOfAll = (
        erasPointss: DeriveEraPoints[]
    ): number => {
        return erasPointss.reduce(
            (ite, cur) => ite + cur.eraPoints.toNumber() || 0,
            0
        )
    }

    validators = await Promise.all(
        validators.map(async (v) => {
            let nomination = (
                await api.derive.staking.query(v.stashId, {
                    withExposure: true,
                })
            ).exposure.total
                .toBn()
                .div(new BN(1e12))
                .toNumber()

            return {
                ...v,
                // todo polkadot should be using 1e10
                nomination,
                avgEraPoints:
                    calculateAvgEraPoints(v.accountId, erasPointss) /
                    weekEras.length,
                AvgEraPointsOfAll:
                    calculateAvgEraPointsOfAll(erasPointss) / weekEras.length,
            }
        })
    )

    const calculateValidatorScore = (v: ValidatorInfo): number => {
        const r =
            v.identity.hasIdentity && !v.blocked && v.identity.display ? 1 : 0
        const cr = v.commissionRate

        const n = v.nomination
        if (n === 0) {
            return 0
        }
        const eep = v.avgEraPoints
        const eepa = v.AvgEraPointsOfAll
        const c0 = 1e6
        const c1 = 1e2
        const c2 = 1
        const sr = slashes.some(
            (s) => s.validators[v.accountId]?.toNumber() > 0
        )
            ? 0
            : 1

        return r * (c0 * (1 - cr)) * (c1 * (1 / n)) * (c2 * (eep / eepa)) * sr
    }

    // https://docs.parallel.fi/dev/staking/staking-election
    validators = validators.map((v) => ({
        ...v,
        score: calculateValidatorScore(v),
    }))

    const goodValidators = orderBy(validators, ['score']).slice(-16)
    console.log(goodValidators)

    // console.log(
    //     erasPoints.map((x) => ({
    //         era: x.era.toJSON(),
    //         validators: x.validators,
    //         erasPoints: x.eraPoints.toJSON(),
    //     }))
    // )

    // const nominators = await api.query.staking.nominators.entries()
    // console.log(nominators.map((x) => x.map((y) => y.toJSON())))
    // const currentPoints = await api.derive.staking.currentPoints()
})()
