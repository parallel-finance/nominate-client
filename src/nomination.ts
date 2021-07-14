interface Coefficients {
    // Reputation, 0 or 1
    r: number
    // Commission Rate
    cr: number
    // Nomination of one validator
    n: number
    // Average Era Points of one validator in the past week.
    eep: number
    // Average Era Points of All validators in the past week.
    eepa: number
    // A constant shows how much influence of the Era Points of a validator. The default value is 1.
    c: number
    // Slash Record, default 1, set to 0 if ever slashed in the past month.
    sr: number
}
