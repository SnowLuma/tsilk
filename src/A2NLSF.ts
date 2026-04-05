import { 
    SKP_LSHIFT, SKP_RSHIFT, SKP_SMLAWW, SKP_SMULBB, SKP_LSHIFT32, 
    SKP_RSHIFT_ROUND, SKP_ADD_RSHIFT, SKP_DIV32_16, SKP_DIV32 
} from './macros';
import { SKP_Silk_LSFCosTab_FIX_Q12, LSF_COS_TAB_SZ_FIX } from './tables/tables_lsf_cos';
import { SKP_Silk_bwexpander_32 } from './bwexpander';
import { MAX_LPC_ORDER } from './defines';

const BIN_DIV_STEPS_A2NLSF_FIX = 3;
const QPoly = 16;
const MAX_ITERATIONS_A2NLSF_FIX = 30;

function SKP_Silk_A2NLSF_trans_poly(p: Int32Array, dd: number): void {
    for (let k = 2; k <= dd; k++) {
        for (let n = dd; n > k; n--) {
            p[n - 2] -= p[n];
        }
        p[k - 2] -= SKP_LSHIFT(p[k], 1);
    }
}

function SKP_Silk_A2NLSF_eval_poly(p: Int32Array, x: number, dd: number): number {
    let y32 = p[dd];
    let x_Q16 = SKP_LSHIFT(x, 4);
    for (let n = dd - 1; n >= 0; n--) {
        y32 = SKP_SMLAWW(p[n], y32, x_Q16);
    }
    return y32;
}

function SKP_Silk_A2NLSF_init(a_Q16: Int32Array, P: Int32Array, Q: Int32Array, dd: number): void {
    P[dd] = SKP_LSHIFT(1, QPoly);
    Q[dd] = SKP_LSHIFT(1, QPoly);
    for (let k = 0; k < dd; k++) {
        P[k] = (-a_Q16[dd - k - 1] - a_Q16[dd + k]) | 0;
        Q[k] = (-a_Q16[dd - k - 1] + a_Q16[dd + k]) | 0;
    }
    for (let k = dd; k > 0; k--) {
        P[k - 1] -= P[k];
        Q[k - 1] += Q[k];
    }
    SKP_Silk_A2NLSF_trans_poly(P, dd);
    SKP_Silk_A2NLSF_trans_poly(Q, dd);
}

export function SKP_Silk_A2NLSF(NLSF: Int32Array, a_Q16: Int32Array, d: number): void {
    let i, k, m, dd, root_ix, ffrac;
    let xlo, xhi, xmid;
    let ylo, yhi, ymid;
    let nom, den;
    let P = new Int32Array(MAX_LPC_ORDER / 2 + 1);
    let Q = new Int32Array(MAX_LPC_ORDER / 2 + 1);
    let PQ = [P, Q];
    let p: Int32Array;

    dd = SKP_RSHIFT(d, 1);
    SKP_Silk_A2NLSF_init(a_Q16, P, Q, dd);

    p = P;
    xlo = SKP_Silk_LSFCosTab_FIX_Q12[0];
    ylo = SKP_Silk_A2NLSF_eval_poly(p, xlo, dd);

    if (ylo < 0) {
        NLSF[0] = 0;
        p = Q;
        ylo = SKP_Silk_A2NLSF_eval_poly(p, xlo, dd);
        root_ix = 1;
    } else {
        root_ix = 0;
    }

    k = 1;
    i = 0;
    while (true) {
        xhi = SKP_Silk_LSFCosTab_FIX_Q12[k];
        yhi = SKP_Silk_A2NLSF_eval_poly(p, xhi, dd);

        if ((ylo <= 0 && yhi >= 0) || (ylo >= 0 && yhi <= 0)) {
            ffrac = -256;
            for (m = 0; m < BIN_DIV_STEPS_A2NLSF_FIX; m++) {
                xmid = SKP_RSHIFT_ROUND(xlo + xhi, 1);
                ymid = SKP_Silk_A2NLSF_eval_poly(p, xmid, dd);

                if ((ylo <= 0 && ymid >= 0) || (ylo >= 0 && ymid <= 0)) {
                    xhi = xmid;
                    yhi = ymid;
                } else {
                    xlo = xmid;
                    ylo = ymid;
                    ffrac = SKP_ADD_RSHIFT(ffrac, 128, m);
                }
            }

            if (Math.abs(ylo) < 65536) {
                den = ylo - yhi;
                nom = SKP_LSHIFT(ylo, 8 - BIN_DIV_STEPS_A2NLSF_FIX) + SKP_RSHIFT(den, 1);
                if (den !== 0) {
                    ffrac += SKP_DIV32(nom, den);
                }
            } else {
                ffrac += SKP_DIV32(ylo, SKP_RSHIFT(ylo - yhi, 8 - BIN_DIV_STEPS_A2NLSF_FIX));
            }

            NLSF[root_ix] = Math.min(SKP_LSHIFT32(k, 8) + ffrac, 32767);
            
            root_ix++;
            if (root_ix >= d) {
                break;
            }
            p = PQ[root_ix & 1];

            xlo = SKP_Silk_LSFCosTab_FIX_Q12[k - 1];
            ylo = SKP_LSHIFT(1 - (root_ix & 2), 12);
        } else {
            k++;
            xlo = xhi;
            ylo = yhi;

            if (k > LSF_COS_TAB_SZ_FIX) {
                i++;
                if (i > MAX_ITERATIONS_A2NLSF_FIX) {
                    NLSF[0] = SKP_DIV32_16(1 << 15, d + 1);
                    for (k = 1; k < d; k++) {
                        NLSF[k] = SKP_SMULBB(k + 1, NLSF[0]);
                    }
                    return;
                }

                SKP_Silk_bwexpander_32(a_Q16, d, 65536 - SKP_SMULBB(10 + i, i));

                SKP_Silk_A2NLSF_init(a_Q16, P, Q, dd);
                p = P;
                xlo = SKP_Silk_LSFCosTab_FIX_Q12[0];
                ylo = SKP_Silk_A2NLSF_eval_poly(p, xlo, dd);
                if (ylo < 0) {
                    NLSF[0] = 0;
                    p = Q;
                    ylo = SKP_Silk_A2NLSF_eval_poly(p, xlo, dd);
                    root_ix = 1;
                } else {
                    root_ix = 0;
                }
                k = 1;
            }
        }
    }
}
