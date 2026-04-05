import { SKP_Silk_CLZ32 as CLZ32, SKP_RSHIFT as RSHIFT, SKP_LSHIFT as LSHIFT, SKP_DIV32_16, SKP_max_32 as max_32, SKP_SAT16, SKP_SMLAWB as SMLAWB } from './macros';
import { MAX_ORDER_LPC } from './defines';

export function schur(
    rc_Q15: Int16Array,
    c: Int32Array,
    order: number
): number {
    let k: number, n: number, lz: number;
    let C = new Int32Array((MAX_ORDER_LPC + 1) * 2);

    let rc_tmp_Q15: number;

    lz = CLZ32(c[0]);

    if (lz < 2) {
        for (k = 0; k < order + 1; k++) {
            C[k * 2] = C[k * 2 + 1] = RSHIFT(c[k], 1);
        }
    } else if (lz > 2) {
        lz -= 2;
        for (k = 0; k < order + 1; k++) {
            C[k * 2] = C[k * 2 + 1] = LSHIFT(c[k], lz);
        }
    } else {
        for (k = 0; k < order + 1; k++) {
            C[k * 2] = C[k * 2 + 1] = c[k];
        }
    }

    for (k = 0; k < order; k++) {
        let div_den = max_32(RSHIFT(C[1], 15), 1);
        rc_tmp_Q15 = -SKP_DIV32_16(C[(k + 1) * 2], div_den);
        rc_tmp_Q15 = SKP_SAT16(rc_tmp_Q15);

        rc_Q15[k] = rc_tmp_Q15;

        for (n = 0; n < order - k; n++) {
            let Ctmp1 = C[(n + k + 1) * 2];
            let Ctmp2 = C[n * 2 + 1];
            C[(n + k + 1) * 2] = SMLAWB(Ctmp1, LSHIFT(Ctmp2, 1), rc_tmp_Q15);
            C[n * 2 + 1] = SMLAWB(Ctmp2, LSHIFT(Ctmp1, 1), rc_tmp_Q15);
        }
    }

    return C[1];
}
