import { 
    SKP_LSHIFT as LSHIFT, SKP_SMLAWB as SMLAWB, SKP_SMULWB as SMULWB, 
    SKP_ADD32 as ADD32, SKP_SUB32 as SUB32, SKP_RSHIFT_ROUND as RSHIFT_ROUND, 
    SKP_SAT16, SKP_RSHIFT as RSHIFT32, SKP_min 
} from "./macros";

export const SKP_Silk_resampler_down2_0 = 9872;
export const SKP_Silk_resampler_down2_1 = 39809 - 65536;

export const SKP_Silk_Resampler_2_3_COEFS_LQ = new Int16Array([
    -2797, -6507,
    4697, 10739,
    1567, 8276
]);

export const SKP_Silk_Resampler_1_3_COEFS_LQ = new Int16Array([
    16777, -9792,
    890, 1614, 2148
]);

export function SKP_Silk_resampler_private_AR2(
    S: Int32Array, S_offset: number,
    out_Q8: Int32Array, out_offset: number,
    in_sig: Int16Array, in_offset: number,
    A_Q14: Int16Array, A_offset: number,
    len: number
): void {
    let k: number;
    let out32: number;

    for (k = 0; k < len; k++) {
        out32 = S[S_offset + 0] + (in_sig[in_offset + k] << 8);
        out_Q8[out_offset + k] = out32;
        out32 = LSHIFT(out32, 2);
        S[S_offset + 0] = SMLAWB(S[S_offset + 1], out32, A_Q14[A_offset + 0]);
        S[S_offset + 1] = SMULWB(out32, A_Q14[A_offset + 1]);
    }
}

export function SKP_Silk_resampler_down2(
    S: Int32Array, S_offset: number,
    out: Int16Array, out_offset: number,
    in_sig: Int16Array, in_offset: number,
    inLen: number
): void {
    let k: number, len2 = inLen >> 1;
    let in32: number, out32: number, Y: number, X: number;

    for (k = 0; k < len2; k++) {
        in32 = in_sig[in_offset + 2 * k] << 10;

        Y = SUB32(in32, S[S_offset + 0]);
        X = SMLAWB(Y, Y, SKP_Silk_resampler_down2_1);
        out32 = ADD32(S[S_offset + 0], X);
        S[S_offset + 0] = ADD32(in32, X);

        in32 = in_sig[in_offset + 2 * k + 1] << 10;

        Y = SUB32(in32, S[S_offset + 1]);
        X = SMULWB(Y, SKP_Silk_resampler_down2_0);
        out32 = ADD32(out32, S[S_offset + 1]);
        out32 = ADD32(out32, X);
        S[S_offset + 1] = ADD32(in32, X);

        out[out_offset + k] = SKP_SAT16(RSHIFT_ROUND(out32, 11));
    }
}

export function SKP_Silk_resampler_down2_3(
    S: Int32Array, S_offset: number,
    out: Int16Array, out_offset: number,
    in_sig: Int16Array, in_offset: number,
    inLen: number
): void {
    const ORDER_FIR = 4;
    const RESAMPLER_MAX_BATCH_SIZE_IN = 480;
    let nSamplesIn: number, counter: number, res_Q6: number;
    let buf = new Int32Array(RESAMPLER_MAX_BATCH_SIZE_IN + ORDER_FIR);
    let buf_ptr = 0;

    buf.set(S.subarray(S_offset, S_offset + ORDER_FIR));

    let in_idx = 0;
    let out_idx = 0;

    while (true) {
        nSamplesIn = SKP_min(inLen, RESAMPLER_MAX_BATCH_SIZE_IN);

        SKP_Silk_resampler_private_AR2(
            S, S_offset + ORDER_FIR, 
            buf, ORDER_FIR, 
            in_sig, in_offset + in_idx, 
            SKP_Silk_Resampler_2_3_COEFS_LQ, 0, 
            nSamplesIn
        );

        buf_ptr = 0;
        counter = nSamplesIn;
        while (counter > 2) {
            res_Q6 = SMULWB(buf[buf_ptr + 0], SKP_Silk_Resampler_2_3_COEFS_LQ[2]);
            res_Q6 = SMLAWB(res_Q6, buf[buf_ptr + 1], SKP_Silk_Resampler_2_3_COEFS_LQ[3]);
            res_Q6 = SMLAWB(res_Q6, buf[buf_ptr + 2], SKP_Silk_Resampler_2_3_COEFS_LQ[5]);
            res_Q6 = SMLAWB(res_Q6, buf[buf_ptr + 3], SKP_Silk_Resampler_2_3_COEFS_LQ[4]);
            out[out_offset + out_idx++] = SKP_SAT16(RSHIFT_ROUND(res_Q6, 6));

            res_Q6 = SMULWB(buf[buf_ptr + 1], SKP_Silk_Resampler_2_3_COEFS_LQ[4]);
            res_Q6 = SMLAWB(res_Q6, buf[buf_ptr + 2], SKP_Silk_Resampler_2_3_COEFS_LQ[5]);
            res_Q6 = SMLAWB(res_Q6, buf[buf_ptr + 3], SKP_Silk_Resampler_2_3_COEFS_LQ[3]);
            res_Q6 = SMLAWB(res_Q6, buf[buf_ptr + 4], SKP_Silk_Resampler_2_3_COEFS_LQ[2]);
            out[out_offset + out_idx++] = SKP_SAT16(RSHIFT_ROUND(res_Q6, 6));

            buf_ptr += 3;
            counter -= 3;
        }

        in_idx += nSamplesIn;
        inLen -= nSamplesIn;

        if (inLen > 0) {
            buf.copyWithin(0, nSamplesIn, nSamplesIn + ORDER_FIR);
        } else {
            break;
        }
    }
    S.set(buf.subarray(nSamplesIn, nSamplesIn + ORDER_FIR), S_offset);
}

export function SKP_Silk_resampler_down3(
    S: Int32Array, S_offset: number,
    out: Int16Array, out_offset: number,
    in_sig: Int16Array, in_offset: number,
    inLen: number
): void {
    const ORDER_FIR = 6;
    const RESAMPLER_MAX_BATCH_SIZE_IN = 480;
    let nSamplesIn: number, counter: number, res_Q6: number;
    let buf = new Int32Array(RESAMPLER_MAX_BATCH_SIZE_IN + ORDER_FIR);
    let buf_ptr = 0;

    buf.set(S.subarray(S_offset, S_offset + ORDER_FIR));

    let in_idx = 0;
    let out_idx = 0;

    while (true) {
        nSamplesIn = SKP_min(inLen, RESAMPLER_MAX_BATCH_SIZE_IN);

        SKP_Silk_resampler_private_AR2(
            S, S_offset + ORDER_FIR, 
            buf, ORDER_FIR, 
            in_sig, in_offset + in_idx, 
            SKP_Silk_Resampler_1_3_COEFS_LQ, 0, 
            nSamplesIn
        );

        buf_ptr = 0;
        counter = nSamplesIn;
        while (counter > 2) {
            res_Q6 = SMULWB(ADD32(buf[buf_ptr + 0], buf[buf_ptr + 5]), SKP_Silk_Resampler_1_3_COEFS_LQ[2]);
            res_Q6 = SMLAWB(res_Q6, ADD32(buf[buf_ptr + 1], buf[buf_ptr + 4]), SKP_Silk_Resampler_1_3_COEFS_LQ[3]);
            res_Q6 = SMLAWB(res_Q6, ADD32(buf[buf_ptr + 2], buf[buf_ptr + 3]), SKP_Silk_Resampler_1_3_COEFS_LQ[4]);
            out[out_offset + out_idx++] = SKP_SAT16(RSHIFT_ROUND(res_Q6, 6));

            buf_ptr += 3;
            counter -= 3;
        }

        in_idx += nSamplesIn;
        inLen -= nSamplesIn;

        if (inLen > 0) {
            buf.copyWithin(0, nSamplesIn, nSamplesIn + ORDER_FIR);
        } else {
            break;
        }
    }
    S.set(buf.subarray(nSamplesIn, nSamplesIn + ORDER_FIR), S_offset);
}
