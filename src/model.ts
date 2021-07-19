import { RewardPoint } from '@polkadot/types/interfaces'
import BN from 'bn.js'

export interface NomineeCoefficients {
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
    nominationBN?: BN
    commissionRate: number
    blocked: boolean
    identity: ValidatorIdentity
    avgEraPoints?: number
    avgEraPointsOfAll?: number
    score?: number
}
