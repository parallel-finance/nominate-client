import commander, { Command } from 'commander'
import { connect } from './api'
import type {
	DeriveEraPoints,
	DeriveEraSlashes
} from '@polkadot/api-derive/types'
import type { NomineeCoefficients, ValidatorInfo } from './model'
import { orderBy } from 'lodash'
import BN from 'bn.js'
import { ApiPromise, Keyring } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import winston from 'winston'
import inquirer from 'inquirer'
import interval from 'interval-promise'
import { u16 } from '@polkadot/types'

const program = new Command()
const maxValidators = 16
const commissionRateDecimal = 1e9
const maxCommissionRate = 0.075 // 7.5%

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
		'ws://127.0.0.1:9948'
	)
	.option(
		'-r, --relay-ws <string>',
		'The Relaychain API endpoint to connect to.',
		'ws://127.0.0.1:9944'
	)
	.option(
		'-t, --tick [number]',
		'The time interval in seconds to feed validators',
		'120000'
	)
	.option('-s, --seed <string>', 'The account seed to use', '//Eve')
	.option('-i, --interactive [boolean]', 'Input seed interactively', false)

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
	coefficients: NomineeCoefficients
): number => {
	const r = v.identity.hasIdentity && !v.blocked && v.identity.display ? 1 : 0
	const cr = v.commissionRate
	const { crf, epf, nf } = coefficients

	const n = v.nomination
	if (n === 0) {
		// ignore new registered validators
		return 0
	}

	if (cr > maxCommissionRate) {
		// ignore high commission rate validators
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
): Promise<void> => {
	const coefficients: NomineeCoefficients = { crf: 100, nf: 1000, epf: 10 }

	logger.info(
		`maxValidators: ${maxValidators}, Coefficients: ${JSON.stringify(
			coefficients
		)}`
	)

	logger.info(`retrieving stash accounts of all validators...`)
	const stashes = (await relayApi.derive.staking.stashes()).map((v) =>
		v.toString()
	)

	logger.info(`retrieving identities of all validators...`)
	const identities = (
		await relayApi.derive.accounts.hasIdentityMulti(stashes)
	).map((identity) => ({
		display: identity.display?.toString(),
		hasIdentity: identity.hasIdentity
	}))

	let validators: ValidatorInfo[] = (
		await relayApi.derive.staking.accounts(stashes)
	).map((sa, idx) => ({
		accountId: sa.accountId.toString(),
		stashId: sa.stashId.toString(),
		controllerId: sa.controllerId.toString(),
		commissionRate:
			sa.validatorPrefs.commission.toNumber() / commissionRateDecimal,
		blocked: sa.validatorPrefs.blocked.toJSON(),
		identity: identities[idx]
	}))

	const allEras = await relayApi.derive.staking?.erasHistoric(false)
	const monthEras = allEras.slice(-28)
	logger.info(`last 28 eras: ${monthEras}`)

	logger.info('retrieving slashes of last 28 eras...')
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
				.div(
					new BN(
						(await relayApi.rpc.system.properties()).tokenDecimals
							.unwrap()[0]
							.toNumber()
					)
				)
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

	logger.info(`calculating validators' scores...`)
	validators = validators.map((v) => ({
		...v,
		score: calculateValidatorScore(v, slashes, coefficients)
	}))

	const result = orderBy(validators, ['score', 'stakes'], ['desc', 'asc'])
		.slice(0, +maxValidators)
		.map((v) => ({
			name: v.identity.display,
			address: v.accountId,
			stakes: v.nominationBN || new BN(0),
			score: v.score || 0
		}))

	logger.info(`nominating validators...`)
	const derivativeIndex = paraApi.consts.liquidStaking
		.derivativeIndex as unknown as u16
	await paraApi.tx.liquidStaking
		.nominate(
			derivativeIndex,
			result.map((v) => v.address)
		)
		.signAndSend(account, {
			nonce: await paraApi.rpc.system.accountNextIndex(account.address)
		})

	logger.info(`done!`)
}

const { relayWs, paraWs, seed, tick, interactive } = program.opts()
;(async () => {
	try {
		const tickInt = +tick
		if (isNaN(tickInt)) {
			throw new commander.InvalidArgumentError('Tick not a number.')
		}

		await cryptoWaitReady()

		const keyring = new Keyring({ type: 'sr25519' })
		const account = keyring.addFromMnemonic(
			interactive
				? (
						await inquirer.prompt<{ seed: string }>([
							{
								type: 'password',
								name: 'seed',
								message: 'Input your seed'
							}
						])
				  ).seed
				: seed
		)

		logger.info(`connecting to relaychain: ${relayWs}`)
		logger.info(`connecting to parachain: ${paraWs}`)
		logger.info(`account: ${account.address}`)

		const { relayApi, paraApi } = await connect(relayWs, paraWs)

		interval(
			async () => {
				logger.info('========= new round ==========')
				const era = await relayApi.query.staking.currentEra()
				logger.info(`era index: ${era.toString()}`)
				logger.info('start to select new validators...')
				await handler(account, relayApi, paraApi)
			},
			tickInt,
			{ stopOnError: false }
		)
	} catch (err) {
		logger.error(`error happened: ${err.message}`)
	}
})()
