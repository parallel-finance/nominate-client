import { Command } from 'commander'
import { connect } from './api'
import type { EraIndex, ValidatorPrefs } from '@polkadot/types/interfaces'
import type {
    DeriveEraPoints,
    DeriveEraPrefs,
    DeriveEraSlashes,
    DeriveStakingAccount,
} from '@polkadot/api-derive/types'
import type {
    ValidatorInfo,
    ValidatorIdentity,
    NomineeScoreCoefficients,
} from './model'
import { orderBy } from 'lodash'
import { identity } from '@polkadot/types/interfaces/definitions'
import BN from 'bn.js'
import { ApiPromise, Keyring } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'

const program = new Command()
const commissionRateDecimal = 1e9

program
    .name('nominate-client')
    .version('1.0.0.', '-v, --vers', 'output the current version')
    .option(
        '-p, --para-ws <string>',
        'The Parachain API endpoint to connect to.',
        'ws://127.0.0.1:9944'
    )
    .option(
        '-r, --relay-ws <string>',
        'The Relaychain API endpoint to connect to.',
        'wss://kusama-rpc.polkadot.io'
    )
    .option('-s, --seed <string>', 'The account seed to use', '//Eve')

program.parse()

const calculateAvgEraPoints = (
    address: string,
    erasPointss: DeriveEraPoints[]
): number => {
    return erasPointss.reduce(
        (ite, cur) => ite + cur.validators[address]?.toNumber() || 0,
        0
    )
}

const calculateAvgEraPointsOfAll = (erasPointss: DeriveEraPoints[]): number => {
    return erasPointss.reduce(
        (ite, cur) => ite + cur.eraPoints.toNumber() || 0,
        0
    )
}

const calculateValidatorScore = (
    v: ValidatorInfo,
    slashes: DeriveEraSlashes[],
    coefficients: any
): number => {
    const r = v.identity.hasIdentity && !v.blocked && v.identity.display ? 1 : 0
    const cr = v.commissionRate
    const { crf, epf, nf } = coefficients

    const n = v.nomination
    if (n === 0) {
        // ignore new registered validators
        return 0
    }

    const eep = v.avgEraPoints
    const eepa = v.avgEraPointsOfAll

    const sr = slashes.some((s) => s.validators[v.accountId]?.toNumber() > 0)
        ? 0
        : 1

    return Math.round(
        r * (crf * (1 - cr) + nf * (1 / n) * (epf * (eep / eepa))) * sr
    )
}

const handler = async (
    account: KeyringPair,
    relayApi: ApiPromise,
    paraApi: ApiPromise
) => {
    const maxValidators = paraApi.consts.nomineeElection.maxValidators.toJSON()
    const coefficients = await paraApi.query.nomineeElection.coefficients()
    const vv = await paraApi.query.nomineeElection.validators()

    const stashes = (await relayApi.derive.staking.stashes()).map((v) =>
        v.toString()
    )

    const identities = (
        await relayApi.derive.accounts.hasIdentityMulti(stashes)
    ).map((identity) => ({
        display: identity.display?.toString(),
        hasIdentity: identity.hasIdentity,
    }))

    let validators: ValidatorInfo[] = (
        await relayApi.derive.staking.accounts(stashes)
    ).map((sa, idx) => {
        return {
            accountId: sa.accountId.toString(),
            stashId: sa.stashId.toString(),
            controllerId: sa.controllerId.toString(),
            commissionRate:
                sa.validatorPrefs.commission.toNumber() / commissionRateDecimal,
            blocked: sa.validatorPrefs.blocked.toJSON(),
            identity: identities[idx],
        }
    })

    const allEras = await relayApi.derive.staking?.erasHistoric(false)
    const monthEras = allEras.slice(-28)

    const slashes = await Promise.all(
        monthEras.map(async (eraIndex) => {
            return await relayApi.derive.staking.eraSlashes(eraIndex)
        })
    )

    const erasPointss = await relayApi.derive.staking._erasPoints(
        monthEras,
        false
    )

    validators = await Promise.all(
        validators.map(async (v) => {
            let nomination = Math.round(
                (
                    await relayApi.derive.staking.query(v.stashId, {
                        withExposure: true,
                    })
                ).exposure.total
                    .toBn()
                    .div(new BN(1e12))
                    .toNumber()
            )

            return {
                ...v,
                nomination,
                avgEraPoints:
                    calculateAvgEraPoints(v.accountId, erasPointss) /
                    monthEras.length,
                avgEraPointsOfAll:
                    calculateAvgEraPointsOfAll(erasPointss) / monthEras.length,
            }
        })
    )

    validators = validators.map((v) => ({
        ...v,
        score: calculateValidatorScore(v, slashes, coefficients.toJSON()),
    }))

    const result = orderBy(validators, ['score'])
        .slice(-maxValidators)
        .map((v) => ({
            name: v.identity.display,
            address: v.accountId,
            stakes: v.nomination || 0,
            score: v.score || 0,
        }))

    await (
        await paraApi.tx.nomineeElection
            .setValidators(result)
            .signAsync(account)
    ).send()
}

const { relayWs, paraWs, seed } = program.opts()
;(async () => {
    const { relayApi, paraApi } = await connect(relayWs, paraWs)

    const keyring = new Keyring({ type: 'sr25519' })
    const account = keyring.addFromMnemonic(seed)

    relayApi.query.staking.currentEra(async () => {
        await handler(account, relayApi, paraApi)
    })
})()
