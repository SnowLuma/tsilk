/**
 * NLSF2A_stable: Convert NLSF to stable AR prediction filter
 * Ported from SKP_Silk_NLSF2A_stable.c
 */
import { MAX_LPC_ORDER, MAX_LPC_STABILIZE_ITERATIONS } from './defines';
import { NLSF2A } from './nlsf_a';
import { SKP_Silk_bwexpander, SKP_SMULBB, toInt16 } from './macros';
import { LPC_inverse_pred_gain } from './lpc_inv_pred_gain';

export function SKP_Silk_NLSF2A_stable(
    pAR_Q12: Int16Array,
    pNLSF: Int32Array | Int16Array,
    LPC_order: number
): number {
    const nlsfQ15 = pNLSF instanceof Int32Array ? pNLSF : Int32Array.from(pNLSF);
    NLSF2A(pAR_Q12, nlsfQ15, LPC_order);

    let stableIters = 0;
    // Ensure stable LPCs
    for (let i = 0; i < MAX_LPC_STABILIZE_ITERATIONS; i++) {
        const { unstable } = LPC_inverse_pred_gain(pAR_Q12, LPC_order);
        if (unstable) {
            // BWE: 65536 - (10+i)*i
            const chirp = 65536 - SKP_SMULBB(10 + i, i);
            SKP_Silk_bwexpander(pAR_Q12, 0, LPC_order, chirp);
            stableIters = i + 1;
        } else {
            stableIters = i;
            break;
        }
    }

    return stableIters;
}

export const NLSF2A_stable = SKP_Silk_NLSF2A_stable;
