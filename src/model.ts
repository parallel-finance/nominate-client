import { RewardPoint } from '@polkadot/types/interfaces'
import BN from 'bn.js'

export interface NomineeScoreCoefficients {
    crf: number
    epf: number
    nf: number
}

export interface ValidatorIdentity {
    hasIdentity: boolean
    display?: string
}

export interface ValidatorInfo {
    accountId: string
    stashId: string
    controllerId: string
    nomination?: number
    commissionRate: number
    blocked: boolean
    identity: ValidatorIdentity
    avgEraPoints?: number
    avgEraPointsOfAll?: number
    score?: number
}
