import { SKP_Silk_inner_prod_aligned } from './pitch_analysis_core';
import { SKP_Silk_sum_sqr_shift, SKP_Silk_CLZ32, SKP_RSHIFT32, SKP_SMULBB, SKP_ADD32, SKP_SUB32, SKP_SMLABB } from './macros';

export function SKP_Silk_corrVector_FIX(
    x: Int16Array,
    x_offset: number,
    t: Int16Array,
    t_offset: number,
    L: number,
    order: number,
    Xt: Int32Array,
    rshifts: number
): void {
    let lag: number, i: number;
    let ptr1 = x_offset + order - 1;
    let ptr2 = t_offset;
    let inner_prod: number;

    if (rshifts > 0) {
        for (lag = 0; lag < order; lag++) {
            inner_prod = 0;
            for (i = 0; i < L; i++) {
                inner_prod += SKP_RSHIFT32(SKP_SMULBB(x[ptr1 + i], t[ptr2 + i]), rshifts);
            }
            Xt[lag] = inner_prod;
            ptr1--;
        }
    } else {
        for (lag = 0; lag < order; lag++) {
            Xt[lag] = SKP_Silk_inner_prod_aligned(x, ptr1, t, ptr2, L);
            ptr1--;
        }
    }
}

export function SKP_Silk_corrMatrix_FIX(
    x: Int16Array,
    x_offset: number,
    L: number,
    order: number,
    head_room: number,
    XX: Int32Array,
    rshifts_ptr: { val: number }
): void {
    let i: number, j: number, lag: number, rshifts_local: number, head_room_rshifts: number;
    let energy: number;
    let ptr1: number, ptr2: number;

    let energy_val = { val: 0 };
    let rshifts_val = { val: 0 };
    SKP_Silk_sum_sqr_shift(energy_val, rshifts_val, x.subarray(x_offset), L + order - 1);
    energy = energy_val.val;
    rshifts_local = rshifts_val.val;

    head_room_rshifts = Math.max(head_room - SKP_Silk_CLZ32(energy), 0);
    
    energy = SKP_RSHIFT32(energy, head_room_rshifts);
    rshifts_local += head_room_rshifts;

    for (i = 0; i < order - 1; i++) {
        energy -= SKP_RSHIFT32(SKP_SMULBB(x[x_offset + i], x[x_offset + i]), rshifts_local);
    }
    if (rshifts_local < rshifts_ptr.val) {
        energy = SKP_RSHIFT32(energy, rshifts_ptr.val - rshifts_local);
        rshifts_local = rshifts_ptr.val;
    }

    XX[0] = energy;
    ptr1 = x_offset + order - 1;
    for (j = 1; j < order; j++) {
        energy = SKP_SUB32(energy, SKP_RSHIFT32(SKP_SMULBB(x[ptr1 + L - j], x[ptr1 + L - j]), rshifts_local));
        energy = SKP_ADD32(energy, SKP_RSHIFT32(SKP_SMULBB(x[ptr1 - j], x[ptr1 - j]), rshifts_local));
        XX[j * order + j] = energy;
    }

    ptr2 = x_offset + order - 2;
    if (rshifts_local > 0) {
        for (lag = 1; lag < order; lag++) {
            energy = 0;
            for (i = 0; i < L; i++) {
                energy += SKP_RSHIFT32(SKP_SMULBB(x[ptr1 + i], x[ptr2 + i]), rshifts_local);
            }
            XX[lag * order + 0] = energy;
            XX[0 * order + lag] = energy;
            for (j = 1; j < (order - lag); j++) {
                energy = SKP_SUB32(energy, SKP_RSHIFT32(SKP_SMULBB(x[ptr1 + L - j], x[ptr2 + L - j]), rshifts_local));
                energy = SKP_ADD32(energy, SKP_RSHIFT32(SKP_SMULBB(x[ptr1 - j], x[ptr2 - j]), rshifts_local));
                XX[(lag + j) * order + j] = energy;
                XX[j * order + (lag + j)] = energy;
            }
            ptr2--;
        }
    } else {
        for (lag = 1; lag < order; lag++) {
            energy = SKP_Silk_inner_prod_aligned(x, ptr1, x, ptr2, L);
            XX[lag * order + 0] = energy;
            XX[0 * order + lag] = energy;
            for (j = 1; j < (order - lag); j++) {
                energy = SKP_SUB32(energy, SKP_SMULBB(x[ptr1 + L - j], x[ptr2 + L - j]));
                energy = SKP_SMLABB(energy, x[ptr1 - j], x[ptr2 - j]);
                XX[(lag + j) * order + j] = energy;
                XX[j * order + (lag + j)] = energy;
            }
            ptr2--;
        }
    }
    rshifts_ptr.val = rshifts_local;
}
