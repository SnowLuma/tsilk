import { SKP_SMLABB, SKP_SUB_SAT32, SKP_RSHIFT_ROUND } from './macros';

/**
 * Variable order MA prediction error filter
 * @param in Input signal
 * @param B MA prediction coefficients, Q12 [order]
 * @param S State vector [order]
 * @param out Output signal
 * @param len Signal length
 * @param Order Filter order (must be even)
 */
export function SKP_Silk_LPC_analysis_filter(
    in_arr: Int16Array | Int32Array,
    B: Int16Array | Int32Array,
    S: Int16Array | Int32Array,
    out: Int16Array | Int32Array,
    len: number,
    Order: number
): void {
    const Order_half = Order >> 1;
    let SA: number, SB: number;
    let out32_Q12: number, out32: number;

    for (let k = 0; k < len; k++) {
        SA = S[0];
        out32_Q12 = 0;
        
        for (let j = 0; j < (Order_half - 1); j++) {
            const idx = (j << 1) + 1;
            SB = S[idx];
            S[idx] = SA;
            out32_Q12 = SKP_SMLABB(out32_Q12, SA, B[idx - 1]);
            out32_Q12 = SKP_SMLABB(out32_Q12, SB, B[idx]);
            SA = S[idx + 1];
            S[idx + 1] = SB;
        }

        /* Unrolled loop: epilog */
        SB = S[Order - 1];
        S[Order - 1] = SA;
        out32_Q12 = SKP_SMLABB(out32_Q12, SA, B[Order - 2]);
        out32_Q12 = SKP_SMLABB(out32_Q12, SB, B[Order - 1]);

        /* Subtract prediction */
        out32_Q12 = SKP_SUB_SAT32((in_arr[k] << 12), out32_Q12);

        /* Scale to Q0 */
        out32 = SKP_RSHIFT_ROUND(out32_Q12, 12);

        /* Saturate output */
        out[k] = out32 > 32767 ? 32767 : (out32 < -32768 ? -32768 : out32);

        /* Move input line */
        S[0] = in_arr[k];
    }
}
