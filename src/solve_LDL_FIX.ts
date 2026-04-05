import { MAX_MATRIX_SIZE } from './defines';
import { 
    SKP_max_32, SKP_SMMUL, SKP_ADD_SAT32, SKP_SMULBB, SKP_SMULWW, SKP_SMLAWW, SKP_SUB32, 
    SKP_INVERSE32_varQ, SKP_LSHIFT, SKP_ADD32, SKP_RSHIFT 
} from './macros';

const FIND_LTP_COND_FAC = 10; // Q31 -> 65536 * 10 / ? Wait, FIND_LTP_COND_FAC is 1e-5. So 1e-5 * 2^31 approx 21474.
const FIND_LTP_COND_FAC_Q31 = 21474;

interface inv_D_t {
    Q36_part: number;
    Q48_part: number;
}

function SKP_Silk_LDL_factorize_FIX(A: Int32Array, M: number, L_Q16: Int32Array, inv_D: inv_D_t[]): void {
    let i: number, j: number, k: number, status: number, loop_count: number;
    let diag_min_value: number, tmp_32: number, err: number;
    let v_Q0 = new Int32Array(MAX_MATRIX_SIZE);
    let D_Q0 = new Int32Array(MAX_MATRIX_SIZE);
    let one_div_diag_Q36: number, one_div_diag_Q40: number, one_div_diag_Q48: number;

    status = 1;
    diag_min_value = SKP_max_32(SKP_SMMUL(SKP_ADD_SAT32(A[0], A[M * M - 1]), FIND_LTP_COND_FAC_Q31), 1 << 9);

    for (loop_count = 0; loop_count < M && status === 1; loop_count++) {
        status = 0;
        for (j = 0; j < M; j++) {
            let ptr1_offset = j * M;
            tmp_32 = 0;
            for (i = 0; i < j; i++) {
                v_Q0[i] = SKP_SMULWW(D_Q0[i], L_Q16[ptr1_offset + i]);
                tmp_32 = SKP_SMLAWW(tmp_32, v_Q0[i], L_Q16[ptr1_offset + i]);
            }
            tmp_32 = SKP_SUB32(A[j * M + j], tmp_32);

            if (tmp_32 < diag_min_value) {
                tmp_32 = SKP_SUB32(SKP_SMULBB(loop_count + 1, diag_min_value), tmp_32);
                for (i = 0; i < M; i++) {
                    A[i * M + i] = SKP_ADD32(A[i * M + i], tmp_32);
                }
                status = 1;
                break;
            }
            D_Q0[j] = tmp_32;
        
            one_div_diag_Q36 = SKP_INVERSE32_varQ(tmp_32, 36);
            one_div_diag_Q40 = SKP_LSHIFT(one_div_diag_Q36, 4);
            err = SKP_SUB32(1 << 24, SKP_SMULWW(tmp_32, one_div_diag_Q40));
            one_div_diag_Q48 = SKP_SMULWW(err, one_div_diag_Q40);

            inv_D[j].Q36_part = one_div_diag_Q36;
            inv_D[j].Q48_part = one_div_diag_Q48;

            L_Q16[j * M + j] = 65536;
            let ptr1_A_offset = j * M;
            let ptr2_offset = (j + 1) * M;
            for (i = j + 1; i < M; i++) {
                tmp_32 = 0;
                for (k = 0; k < j; k++) {
                    tmp_32 = SKP_SMLAWW(tmp_32, v_Q0[k], L_Q16[ptr2_offset + k]);
                }
                tmp_32 = SKP_SUB32(A[ptr1_A_offset + i], tmp_32);

                L_Q16[i * M + j] = SKP_ADD32(
                    SKP_SMMUL(tmp_32, one_div_diag_Q48),
                    SKP_RSHIFT(SKP_SMULWW(tmp_32, one_div_diag_Q36), 4)
                );

                ptr2_offset += M;
            }
        }
    }
}

function SKP_Silk_LS_divide_Q16_FIX(T: Int32Array, inv_D: inv_D_t[], M: number): void {
    let i: number;
    let tmp_32: number;
    let one_div_diag_Q36: number, one_div_diag_Q48: number;

    for (i = 0; i < M; i++) {
        one_div_diag_Q36 = inv_D[i].Q36_part;
        one_div_diag_Q48 = inv_D[i].Q48_part;

        tmp_32 = T[i];
        T[i] = SKP_ADD32(
            SKP_SMMUL(tmp_32, one_div_diag_Q48), 
            SKP_RSHIFT(SKP_SMULWW(tmp_32, one_div_diag_Q36), 4)
        );
    }
}

function SKP_Silk_LS_SolveFirst_FIX(L_Q16: Int32Array, M: number, b: Int32Array, x_Q16: Int32Array): void {
    let i: number, j: number;
    let tmp_32: number;

    for (i = 0; i < M; i++) {
        let ptr32_offset = i * M;
        tmp_32 = 0;
        for (j = 0; j < i; j++) {
            tmp_32 = SKP_SMLAWW(tmp_32, L_Q16[ptr32_offset + j], x_Q16[j]);
        }
        x_Q16[i] = SKP_SUB32(b[i], tmp_32);
    }
}

function SKP_Silk_LS_SolveLast_FIX(L_Q16: Int32Array, M: number, b: Int32Array, x_Q16: Int32Array): void {
    let i: number, j: number;
    let tmp_32: number;

    for (i = M - 1; i >= 0; i--) {
        let ptr32_offset = i;
        tmp_32 = 0;
        for (j = M - 1; j > i; j--) {
            tmp_32 = SKP_SMLAWW(tmp_32, L_Q16[j * M + ptr32_offset], x_Q16[j]);
        }
        x_Q16[i] = SKP_SUB32(b[i], tmp_32);
    }
}

export function SKP_Silk_solve_LDL_FIX(
    A: Int32Array,
    M: number,
    b: Int32Array,
    x_Q16: Int32Array
): void {
    let L_Q16 = new Int32Array(MAX_MATRIX_SIZE * MAX_MATRIX_SIZE);
    let Y = new Int32Array(MAX_MATRIX_SIZE);
    let inv_D: inv_D_t[] = Array.from({ length: MAX_MATRIX_SIZE }, () => ({ Q36_part: 0, Q48_part: 0 }));

    SKP_Silk_LDL_factorize_FIX(A, M, L_Q16, inv_D);
    SKP_Silk_LS_SolveFirst_FIX(L_Q16, M, b, Y);
    SKP_Silk_LS_divide_Q16_FIX(Y, inv_D, M);
    SKP_Silk_LS_SolveLast_FIX(L_Q16, M, Y, x_Q16);
}

export function SKP_Silk_regularize_correlations_FIX(
    XX: Int32Array,
    xx: { val: number } | Int32Array,
    xx_offset: number,
    noise: number,
    D: number
): void {
    let i: number;
    for (i = 0; i < D; i++) {
        XX[i * D + i] = SKP_ADD32(XX[i * D + i], noise);
    }
    if ((xx as Int32Array).length !== undefined) {
        (xx as Int32Array)[xx_offset] += noise;
    } else {
        (xx as { val: number }).val += noise;
    }
}
