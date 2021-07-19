import { Command } from 'commander'
import { connect } from './api'
import type {
	DeriveEraPoints,
	DeriveEraSlashes
} from '@polkadot/api-derive/types'
import type { ValidatorInfo } from './model'
import { orderBy } from 'lodash'
import BN from 'bn.js'
import { ApiPromise, Keyring } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'
import winston from 'winston'

const program = new Command()
const commissionRateDecimal = 1e9
const relayNativeTokenDecimal = 1e12

const logger = winston.createLogger({
	level: 'info',
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.simple()
			)
		}),
		new winston.transports.File({
			filename: 'errors.log',
			level: 'error'
		})
	]
})

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
	const coefficients = (
		await paraApi.query.nomineeElection.coefficients()
	).toJSON()

	const stashes = (await relayApi.derive.staking.stashes()).map((v) =>
		v.toString()
	)

	const identities = (
		await relayApi.derive.accounts.hasIdentityMulti(stashes)
	).map((identity) => ({
		display: identity.display?.toString(),
		hasIdentity: identity.hasIdentity
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
			identity: identities[idx]
		}
	})

	const allEras = await relayApi.derive.staking?.erasHistoric(false)
	const monthEras = allEras.slice(-28)

	const slashes = await Promise.all(
		monthEras.map(async (eraIndex) => {
			return await relayApi.derive.staking.eraSlashes(eraIndex)
		})
	)

	// TODO don't use internal function
	const erasPointss = await relayApi.derive.staking._erasPoints(
		monthEras,
		false
	)

	validators = await Promise.all(
		validators.map(async (v) => {
			const exposure = (
				await relayApi.derive.staking.query(v.stashId, {
					withExposure: true
				})
			).exposure

			const nominationBN = exposure.total.toBn().sub(exposure.own.toBn())

			const nomination = nominationBN
				.div(new BN(relayNativeTokenDecimal))
				.toNumber()

			return {
				...v,
				nomination,
				nominationBN,
				avgEraPoints:
					calculateAvgEraPoints(v.accountId, erasPointss) /
					monthEras.length,
				avgEraPointsOfAll:
					calculateAvgEraPointsOfAll(erasPointss) / monthEras.length
			}
		})
	)

	validators = validators.map((v) => ({
		...v,
		score: calculateValidatorScore(v, slashes, coefficients)
	}))

	const result = orderBy(validators, ['score', 'stakes'], ['desc', 'asc'])
		.slice(-maxValidators)
		.map((v) => ({
			name: v.identity.display,
			address: v.accountId,
			stakes: v.nominationBN || new BN(0),
			score: v.score || 0
		}))

	const tx = await paraApi.tx.nomineeElection
		.setValidators(result)
		.signAsync(account)

	await tx.send()
}

const { relayWs, paraWs, seed } = program.opts()
;(async () => {
	try {
		logger.info(`initializing connection to relaychain: ${relayWs}`)
		logger.info(`initializing connection to parachain: ${paraWs}`)

		const { relayApi, paraApi } = await connect(relayWs, paraWs)

		const keyring = new Keyring({ type: 'sr25519' })
		const account = keyring.addFromMnemonic(seed)
		logger.info(`feeder: ${account.address}`)

		relayApi.query.staking.currentEra(async (era) => {
			logger.info(`era index: ${era.toString()}`)
			logger.info('start to select new validators...')
			await handler(account, relayApi, paraApi)
		})
	} catch (err) {
		logger.error(`error happened: ${err.message}`)
	}
})()
