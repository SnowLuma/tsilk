import { EncoderControl, EncoderState } from './structs';
import {
    DECISION_DELAY,
    LTP_ORDER,
    MAX_FRAME_LENGTH,
    MAX_LPC_ORDER,
    MAX_SHAPE_LPC_ORDER,
    NB_SUBFR,
    NSQ_LPC_BUF_LENGTH,
    SIG_TYPE_VOICED,
} from './defines';
import {
    SKP_ADD32,
    SKP_ADD_RSHIFT,
    SKP_DIV32_varQ,
    SKP_INT32_MAX,
    SKP_INVERSE32_varQ,
    SKP_LIMIT_32,
    SKP_LSHIFT,
    SKP_MUL,
    SKP_RAND,
    SKP_RSHIFT,
    SKP_RSHIFT_ROUND,
    SKP_SAT16,
    SKP_Silk_MA_Prediction,
    SKP_SMLABB,
    SKP_SMULBB,
    SKP_SMULWB,
    SKP_SMULWW,
    SKP_SMLAWB,
    SKP_SMLAWT,
    SKP_SUB32,
    SKP_max,
    SKP_min,
} from './macros';
import { SKP_Silk_Quantization_Offsets_Q10 } from './tables/tables_other';

type NSQState = {
    xq: Int16Array;
    sLTP_shp_Q10: Int32Array;
    sLPC_Q14: Int32Array;
    sAR2_Q14: Int32Array;
    sLF_AR_shp_Q12: number;
    lagPrev: number;
    sLTP_buf_idx: number;
    sLTP_shp_buf_idx: number;
    rand_seed: number;
    prev_inv_gain_Q16: number;
    rewhite_flag: number;
};

type DelayedDecisionState = {
    RandState: Int32Array;
    Q_Q10: Int32Array;
    Xq_Q10: Int32Array;
    Pred_Q16: Int32Array;
    Shape_Q10: Int32Array;
    Gain_Q16: Int32Array;
    sAR2_Q14: Int32Array;
    sLPC_Q14: Int32Array;
    LF_AR_Q12: number;
    Seed: number;
    SeedInit: number;
    RD_Q10: number;
};

type SampleState = {
    Q_Q10: number;
    RD_Q10: number;
    xq_Q14: number;
    LF_AR_Q12: number;
    sLTP_shp_Q10: number;
    LPC_exc_Q16: number;
};

const HARM_SHAPE_FIR_TAPS = 3;
const MAX_DEL_DEC_STATES = 4;
const DECISION_DELAY_MASK = DECISION_DELAY - 1;

function clampPulse(q: number): number {
    if (q > 64) return 64;
    if (q < -64) return -64;
    return q;
}

function addLShift32(a: number, b: number, shift: number): number {
    return SKP_ADD32(a, SKP_LSHIFT(b, shift));
}

function subLShift32(a: number, b: number, shift: number): number {
    return SKP_SUB32(a, SKP_LSHIFT(b, shift));
}

function subRShift32(a: number, b: number, shift: number): number {
    return SKP_SUB32(a, SKP_RSHIFT(b, shift));
}

function createDelayedDecisionState(): DelayedDecisionState {
    return {
        RandState: new Int32Array(DECISION_DELAY),
        Q_Q10: new Int32Array(DECISION_DELAY),
        Xq_Q10: new Int32Array(DECISION_DELAY),
        Pred_Q16: new Int32Array(DECISION_DELAY),
        Shape_Q10: new Int32Array(DECISION_DELAY),
        Gain_Q16: new Int32Array(DECISION_DELAY),
        sAR2_Q14: new Int32Array(MAX_SHAPE_LPC_ORDER),
        sLPC_Q14: new Int32Array(NSQ_LPC_BUF_LENGTH + (MAX_FRAME_LENGTH / NB_SUBFR)),
        LF_AR_Q12: 0,
        Seed: 0,
        SeedInit: 0,
        RD_Q10: 0,
    };
}

function createSampleState(): SampleState {
    return {
        Q_Q10: 0,
        RD_Q10: 0,
        xq_Q14: 0,
        LF_AR_Q12: 0,
        sLTP_shp_Q10: 0,
        LPC_exc_Q16: 0,
    };
}

function ensureNSQState(psEnc: EncoderState, useLbrr: boolean): NSQState {
    const key = useLbrr ? 'sNSQ_LBRR' : 'sNSQ';
    const s = (psEnc as any)[key] as Partial<NSQState>;

    if (!s.xq) s.xq = new Int16Array(2 * MAX_FRAME_LENGTH);
    if (!s.sLTP_shp_Q10) s.sLTP_shp_Q10 = new Int32Array(2 * MAX_FRAME_LENGTH);
    if (!s.sLPC_Q14) s.sLPC_Q14 = new Int32Array(NSQ_LPC_BUF_LENGTH + (MAX_FRAME_LENGTH / NB_SUBFR));
    if (!s.sAR2_Q14) s.sAR2_Q14 = new Int32Array(MAX_SHAPE_LPC_ORDER);
    if (typeof s.sLF_AR_shp_Q12 !== 'number') s.sLF_AR_shp_Q12 = 0;
    if (typeof s.lagPrev !== 'number') s.lagPrev = 100;
    if (typeof s.sLTP_buf_idx !== 'number') s.sLTP_buf_idx = psEnc.frame_length;
    if (typeof s.sLTP_shp_buf_idx !== 'number') s.sLTP_shp_buf_idx = psEnc.frame_length;
    if (typeof s.rand_seed !== 'number') s.rand_seed = 1;
    if (typeof s.prev_inv_gain_Q16 !== 'number' || s.prev_inv_gain_Q16 === 0) s.prev_inv_gain_Q16 = 65536;
    if (typeof s.rewhite_flag !== 'number') s.rewhite_flag = 0;

    return s as NSQState;
}

function traceNSQSubframes(
    psEnc: EncoderState,
    q: Int8Array,
    qBase: number,
    xq: Int16Array,
    xqBase: number,
    subfr_length: number,
    lags: number[],
    gainsQ16: Int32Array,
    invGainsQ16: number[],
    rewhiteFlags: number[],
    ltpBufIdxs: number[],
    shpBufIdxs: number[]
): void {
    const frameNo = (psEnc.frameCounter | 0) + 1;
    for (let k = 0; k < NB_SUBFR; k++) {
        const qOffset = qBase + k * subfr_length;
        const xqOffset = xqBase + k * subfr_length;
        let qSum = 0;
        for (let i = 0; i < subfr_length; i++) {
            qSum += q[qOffset + i] | 0;
        }
    }
}

function copyFinalNSQState(NSQ: NSQState, frame_length: number): void {
    for (let i = 0; i < frame_length; i++) {
        NSQ.xq[i] = NSQ.xq[frame_length + i];
        NSQ.sLTP_shp_Q10[i] = NSQ.sLTP_shp_Q10[frame_length + i];
    }
}

function copyDelayedDecisionState(dst: DelayedDecisionState, src: DelayedDecisionState, lpcStateIdx: number): void {
    dst.RandState.set(src.RandState);
    dst.Q_Q10.set(src.Q_Q10);
    dst.Pred_Q16.set(src.Pred_Q16);
    dst.Shape_Q10.set(src.Shape_Q10);
    dst.Xq_Q10.set(src.Xq_Q10);
    dst.sAR2_Q14.set(src.sAR2_Q14);
    for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
        dst.sLPC_Q14[lpcStateIdx + i] = src.sLPC_Q14[lpcStateIdx + i];
    }
    dst.LF_AR_Q12 = src.LF_AR_Q12;
    dst.Seed = src.Seed;
    dst.SeedInit = src.SeedInit;
    dst.RD_Q10 = src.RD_Q10;
}

function nsqScaleStates(
    NSQ: NSQState,
    x: Int16Array,
    xOffset: number,
    x_sc_Q10: Int32Array,
    subfr_length: number,
    sLTP: Int16Array,
    sLTP_Q16: Int32Array,
    subfr: number,
    LTP_scale_Q14: number,
    Gains_Q16: Int32Array,
    pitchL: Int32Array
): number {
    let inv_gain_Q16 = SKP_INVERSE32_varQ(SKP_max(Gains_Q16[subfr] | 0, 1), 32);
    inv_gain_Q16 = SKP_min(inv_gain_Q16, 32767);
    const lag = pitchL[subfr] | 0;

    if (NSQ.rewhite_flag) {
        let inv_gain_Q32 = SKP_LSHIFT(inv_gain_Q16, 16);
        if (subfr === 0) {
            inv_gain_Q32 = SKP_LSHIFT(SKP_SMULWB(inv_gain_Q32, LTP_scale_Q14), 2);
        }
        for (let i = NSQ.sLTP_buf_idx - lag - (LTP_ORDER >> 1); i < NSQ.sLTP_buf_idx; i++) {
            sLTP_Q16[i] = SKP_SMULWB(inv_gain_Q32, sLTP[i]);
        }
    }

    if (inv_gain_Q16 !== NSQ.prev_inv_gain_Q16) {
        const gain_adj_Q16 = SKP_DIV32_varQ(inv_gain_Q16, NSQ.prev_inv_gain_Q16, 16);

        for (let i = NSQ.sLTP_shp_buf_idx - subfr_length * NB_SUBFR; i < NSQ.sLTP_shp_buf_idx; i++) {
            NSQ.sLTP_shp_Q10[i] = SKP_SMULWW(gain_adj_Q16, NSQ.sLTP_shp_Q10[i]);
        }

        if (NSQ.rewhite_flag === 0) {
            for (let i = NSQ.sLTP_buf_idx - lag - (LTP_ORDER >> 1); i < NSQ.sLTP_buf_idx; i++) {
                sLTP_Q16[i] = SKP_SMULWW(gain_adj_Q16, sLTP_Q16[i]);
            }
        }

        NSQ.sLF_AR_shp_Q12 = SKP_SMULWW(gain_adj_Q16, NSQ.sLF_AR_shp_Q12);

        for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
            NSQ.sLPC_Q14[i] = SKP_SMULWW(gain_adj_Q16, NSQ.sLPC_Q14[i]);
        }
        for (let i = 0; i < MAX_SHAPE_LPC_ORDER; i++) {
            NSQ.sAR2_Q14[i] = SKP_SMULWW(gain_adj_Q16, NSQ.sAR2_Q14[i]);
        }
    }

    for (let i = 0; i < subfr_length; i++) {
        x_sc_Q10[i] = SKP_RSHIFT(SKP_SMULBB(x[xOffset + i], inv_gain_Q16), 6);
    }

    NSQ.prev_inv_gain_Q16 = inv_gain_Q16;
    return inv_gain_Q16;
}

function nsqDelDecScaleStates(
    NSQ: NSQState,
    psDelDec: DelayedDecisionState[],
    x: Int16Array,
    xOffset: number,
    x_sc_Q10: Int32Array,
    subfr_length: number,
    sLTP: Int16Array,
    sLTP_Q16: Int32Array,
    subfr: number,
    nStatesDelayedDecision: number,
    LTP_scale_Q14: number,
    Gains_Q16: Int32Array,
    pitchL: Int32Array
): number {
    let inv_gain_Q16 = SKP_INVERSE32_varQ(SKP_max(Gains_Q16[subfr] | 0, 1), 32);
    inv_gain_Q16 = SKP_min(inv_gain_Q16, 32767);
    const lag = pitchL[subfr] | 0;

    if (NSQ.rewhite_flag) {
        let inv_gain_Q32 = SKP_LSHIFT(inv_gain_Q16, 16);
        if (subfr === 0) {
            inv_gain_Q32 = SKP_LSHIFT(SKP_SMULWB(inv_gain_Q32, LTP_scale_Q14), 2);
        }
        for (let i = NSQ.sLTP_buf_idx - lag - (LTP_ORDER >> 1); i < NSQ.sLTP_buf_idx; i++) {
            sLTP_Q16[i] = SKP_SMULWB(inv_gain_Q32, sLTP[i]);
        }
    }

    if (inv_gain_Q16 !== NSQ.prev_inv_gain_Q16) {
        const gain_adj_Q16 = SKP_DIV32_varQ(inv_gain_Q16, NSQ.prev_inv_gain_Q16, 16);

        for (let i = NSQ.sLTP_shp_buf_idx - subfr_length * NB_SUBFR; i < NSQ.sLTP_shp_buf_idx; i++) {
            NSQ.sLTP_shp_Q10[i] = SKP_SMULWW(gain_adj_Q16, NSQ.sLTP_shp_Q10[i]);
        }

        if (NSQ.rewhite_flag === 0) {
            for (let i = NSQ.sLTP_buf_idx - lag - (LTP_ORDER >> 1); i < NSQ.sLTP_buf_idx; i++) {
                sLTP_Q16[i] = SKP_SMULWW(gain_adj_Q16, sLTP_Q16[i]);
            }
        }

        for (let k = 0; k < nStatesDelayedDecision; k++) {
            const psDD = psDelDec[k];
            psDD.LF_AR_Q12 = SKP_SMULWW(gain_adj_Q16, psDD.LF_AR_Q12);
            for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
                psDD.sLPC_Q14[i] = SKP_SMULWW(gain_adj_Q16, psDD.sLPC_Q14[i]);
            }
            for (let i = 0; i < MAX_SHAPE_LPC_ORDER; i++) {
                psDD.sAR2_Q14[i] = SKP_SMULWW(gain_adj_Q16, psDD.sAR2_Q14[i]);
            }
            for (let i = 0; i < DECISION_DELAY; i++) {
                psDD.Pred_Q16[i] = SKP_SMULWW(gain_adj_Q16, psDD.Pred_Q16[i]);
                psDD.Shape_Q10[i] = SKP_SMULWW(gain_adj_Q16, psDD.Shape_Q10[i]);
            }
        }
    }

    for (let i = 0; i < subfr_length; i++) {
        x_sc_Q10[i] = SKP_RSHIFT(SKP_SMULBB(x[xOffset + i], inv_gain_Q16), 6);
    }

    NSQ.prev_inv_gain_Q16 = inv_gain_Q16;
    return inv_gain_Q16;
}

function noiseShapeQuantizer(
    NSQ: NSQState,
    sigtype: number,
    x_sc_Q10: Int32Array,
    q: Int8Array,
    qOffset: number,
    xq: Int16Array,
    xqOffset: number,
    sLTP_Q16: Int32Array,
    a_Q12: Int16Array,
    aOffset: number,
    b_Q14: Int16Array,
    bOffset: number,
    AR_shp_Q13: Int16Array,
    arOffset: number,
    lag: number,
    HarmShapeFIRPacked_Q14: number,
    Tilt_Q14: number,
    LF_shp_Q14: number,
    Gain_Q16: number,
    Lambda_Q10: number,
    offset_Q10: number,
    length: number,
    shapingLPCOrder: number,
    predictLPCOrder: number
): void {
    let shp_lag_ptr_idx = NSQ.sLTP_shp_buf_idx - lag + (HARM_SHAPE_FIR_TAPS >> 1);
    let pred_lag_ptr_idx = NSQ.sLTP_buf_idx - lag + (LTP_ORDER >> 1);
    let psLPC_idx = NSQ_LPC_BUF_LENGTH - 1;

    const thr1_Q10 = SKP_SUB32(-1536, SKP_RSHIFT(Lambda_Q10, 1));
    let thr2_Q10 = SKP_SUB32(-512, SKP_RSHIFT(Lambda_Q10, 1));
    thr2_Q10 = SKP_ADD_RSHIFT(thr2_Q10, SKP_SMULBB(offset_Q10, Lambda_Q10), 10);
    const thr3_Q10 = SKP_ADD32(512, SKP_RSHIFT(Lambda_Q10, 1));

    for (let i = 0; i < length; i++) {
        NSQ.rand_seed = SKP_RAND(NSQ.rand_seed);
        const dither = SKP_RSHIFT(NSQ.rand_seed, 31);

        let LPC_pred_Q10 = SKP_SMULWB(NSQ.sLPC_Q14[psLPC_idx], a_Q12[aOffset]);
        for (let j = 1; j < predictLPCOrder; j++) {
            LPC_pred_Q10 = SKP_SMLAWB(LPC_pred_Q10, NSQ.sLPC_Q14[psLPC_idx - j], a_Q12[aOffset + j]);
        }

        let LTP_pred_Q14 = 0;
        if (sigtype === SIG_TYPE_VOICED) {
            LTP_pred_Q14 = SKP_SMULWB(sLTP_Q16[pred_lag_ptr_idx], b_Q14[bOffset]);
            for (let j = 1; j < LTP_ORDER; j++) {
                LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, sLTP_Q16[pred_lag_ptr_idx - j], b_Q14[bOffset + j]);
            }
            pred_lag_ptr_idx++;
        }

        let tmp2 = NSQ.sLPC_Q14[psLPC_idx];
        let tmp1 = NSQ.sAR2_Q14[0];
        NSQ.sAR2_Q14[0] = tmp2;
        let n_AR_Q10 = SKP_SMULWB(tmp2, AR_shp_Q13[arOffset]);

        for (let j = 2; j < shapingLPCOrder; j += 2) {
            tmp2 = NSQ.sAR2_Q14[j - 1];
            NSQ.sAR2_Q14[j - 1] = tmp1;
            n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, tmp1, AR_shp_Q13[arOffset + j - 1]);

            tmp1 = NSQ.sAR2_Q14[j];
            NSQ.sAR2_Q14[j] = tmp2;
            n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, tmp2, AR_shp_Q13[arOffset + j]);
        }
        NSQ.sAR2_Q14[shapingLPCOrder - 1] = tmp1;
        n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, tmp1, AR_shp_Q13[arOffset + shapingLPCOrder - 1]);
        n_AR_Q10 = SKP_RSHIFT(n_AR_Q10, 1);
        n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, NSQ.sLF_AR_shp_Q12, Tilt_Q14);

        let n_LF_Q10 = SKP_LSHIFT(SKP_SMULWB(NSQ.sLTP_shp_Q10[NSQ.sLTP_shp_buf_idx - 1], LF_shp_Q14), 2);
        n_LF_Q10 = SKP_SMLAWT(n_LF_Q10, NSQ.sLF_AR_shp_Q12, LF_shp_Q14);

        let n_LTP_Q14 = 0;
        if (lag > 0) {
            n_LTP_Q14 = SKP_SMULWB(
                SKP_ADD32(NSQ.sLTP_shp_Q10[shp_lag_ptr_idx], NSQ.sLTP_shp_Q10[shp_lag_ptr_idx - 2]),
                HarmShapeFIRPacked_Q14
            );
            n_LTP_Q14 = SKP_SMLAWT(n_LTP_Q14, NSQ.sLTP_shp_Q10[shp_lag_ptr_idx - 1], HarmShapeFIRPacked_Q14);
            n_LTP_Q14 = SKP_LSHIFT(n_LTP_Q14, 6);
            shp_lag_ptr_idx++;
        }

        let tmp = SKP_SUB32(LTP_pred_Q14, n_LTP_Q14);
        tmp = SKP_RSHIFT(tmp, 4);
        tmp = SKP_ADD32(tmp, LPC_pred_Q10);
        tmp = SKP_SUB32(tmp, n_AR_Q10);
        tmp = SKP_SUB32(tmp, n_LF_Q10);
        let r_Q10 = SKP_SUB32(x_sc_Q10[i], tmp);

        r_Q10 = SKP_SUB32((r_Q10 ^ dither) - dither, offset_Q10);
        r_Q10 = SKP_LIMIT_32(r_Q10, -(64 << 10), 64 << 10);

        let q_Q0 = 0;
        let q_Q10 = 0;
        if (r_Q10 < thr2_Q10) {
            if (r_Q10 < thr1_Q10) {
                q_Q0 = SKP_RSHIFT_ROUND(SKP_ADD32(r_Q10, SKP_RSHIFT(Lambda_Q10, 1)), 10);
                q_Q10 = SKP_LSHIFT(q_Q0, 10);
            } else {
                q_Q0 = -1;
                q_Q10 = -1024;
            }
        } else if (r_Q10 > thr3_Q10) {
            q_Q0 = SKP_RSHIFT_ROUND(SKP_SUB32(r_Q10, SKP_RSHIFT(Lambda_Q10, 1)), 10);
            q_Q10 = SKP_LSHIFT(q_Q0, 10);
        }
        q_Q0 = clampPulse(q_Q0);
        q[qOffset + i] = q_Q0;

        let exc_Q10 = SKP_ADD32(q_Q10, offset_Q10);
        exc_Q10 = (exc_Q10 ^ dither) - dither;

        const LPC_exc_Q10 = SKP_ADD32(exc_Q10, SKP_RSHIFT_ROUND(LTP_pred_Q14, 4));
        const xq_Q10 = SKP_ADD32(LPC_exc_Q10, LPC_pred_Q10);

        xq[xqOffset + i] = SKP_SAT16(SKP_RSHIFT_ROUND(SKP_SMULWW(xq_Q10, Gain_Q16), 10));

        psLPC_idx++;
        NSQ.sLPC_Q14[psLPC_idx] = SKP_LSHIFT(xq_Q10, 4);
        const sLF_AR_shp_Q10 = SKP_SUB32(xq_Q10, n_AR_Q10);
        NSQ.sLF_AR_shp_Q12 = SKP_LSHIFT(sLF_AR_shp_Q10, 2);

        NSQ.sLTP_shp_Q10[NSQ.sLTP_shp_buf_idx] = SKP_SUB32(sLF_AR_shp_Q10, n_LF_Q10);
        sLTP_Q16[NSQ.sLTP_buf_idx] = SKP_LSHIFT(LPC_exc_Q10, 6);
        NSQ.sLTP_shp_buf_idx++;
        NSQ.sLTP_buf_idx++;
        NSQ.rand_seed = SKP_ADD32(NSQ.rand_seed, q[qOffset + i]);
    }

    for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
        NSQ.sLPC_Q14[i] = NSQ.sLPC_Q14[length + i];
    }
}

function noiseShapeQuantizerDelDec(
    NSQ: NSQState,
    psDelDec: DelayedDecisionState[],
    sigtype: number,
    x_Q10: Int32Array,
    q: Int8Array,
    qOffset: number,
    xq: Int16Array,
    xqOffset: number,
    sLTP_Q16: Int32Array,
    a_Q12: Int16Array,
    aOffset: number,
    b_Q14: Int16Array,
    bOffset: number,
    AR_shp_Q13: Int16Array,
    arOffset: number,
    lag: number,
    HarmShapeFIRPacked_Q14: number,
    Tilt_Q14: number,
    LF_shp_Q14: number,
    Gain_Q16: number,
    Lambda_Q10: number,
    offset_Q10: number,
    length: number,
    subfr: number,
    shapingLPCOrder: number,
    predictLPCOrder: number,
    warping_Q16: number,
    nStatesDelayedDecision: number,
    smplBufIdxRef: { val: number },
    decisionDelay: number
): void {
    let shp_lag_ptr_idx = NSQ.sLTP_shp_buf_idx - lag + (HARM_SHAPE_FIR_TAPS >> 1);
    let pred_lag_ptr_idx = NSQ.sLTP_buf_idx - lag + (LTP_ORDER >> 1);
    const sampleStates = Array.from({ length: MAX_DEL_DEC_STATES }, () => [createSampleState(), createSampleState()]);

    for (let i = 0; i < length; i++) {
        let LTP_pred_Q14 = 0;
        if (sigtype === SIG_TYPE_VOICED) {
            LTP_pred_Q14 = SKP_SMULWB(sLTP_Q16[pred_lag_ptr_idx], b_Q14[bOffset]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, sLTP_Q16[pred_lag_ptr_idx - 1], b_Q14[bOffset + 1]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, sLTP_Q16[pred_lag_ptr_idx - 2], b_Q14[bOffset + 2]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, sLTP_Q16[pred_lag_ptr_idx - 3], b_Q14[bOffset + 3]);
            LTP_pred_Q14 = SKP_SMLAWB(LTP_pred_Q14, sLTP_Q16[pred_lag_ptr_idx - 4], b_Q14[bOffset + 4]);
            pred_lag_ptr_idx++;
        }

        let n_LTP_Q14 = 0;
        if (lag > 0) {
            n_LTP_Q14 = SKP_SMULWB(
                SKP_ADD32(NSQ.sLTP_shp_Q10[shp_lag_ptr_idx], NSQ.sLTP_shp_Q10[shp_lag_ptr_idx - 2]),
                HarmShapeFIRPacked_Q14
            );
            n_LTP_Q14 = SKP_SMLAWT(n_LTP_Q14, NSQ.sLTP_shp_Q10[shp_lag_ptr_idx - 1], HarmShapeFIRPacked_Q14);
            n_LTP_Q14 = SKP_LSHIFT(n_LTP_Q14, 6);
            shp_lag_ptr_idx++;
        }

        for (let k = 0; k < nStatesDelayedDecision; k++) {
            const psDD = psDelDec[k];
            const bestState = sampleStates[k][0];
            const secondState = sampleStates[k][1];

            psDD.Seed = SKP_RAND(psDD.Seed);
            const dither = SKP_RSHIFT(psDD.Seed, 31);

            const psLPC_idx = NSQ_LPC_BUF_LENGTH - 1 + i;
            let LPC_pred_Q10 = SKP_SMULWB(psDD.sLPC_Q14[psLPC_idx], a_Q12[aOffset]);
            for (let j = 1; j < predictLPCOrder; j++) {
                LPC_pred_Q10 = SKP_SMLAWB(LPC_pred_Q10, psDD.sLPC_Q14[psLPC_idx - j], a_Q12[aOffset + j]);
            }

            let tmp2 = SKP_SMLAWB(psDD.sLPC_Q14[psLPC_idx], psDD.sAR2_Q14[0], warping_Q16);
            let tmp1 = SKP_SMLAWB(psDD.sAR2_Q14[0], SKP_SUB32(psDD.sAR2_Q14[1], tmp2), warping_Q16);
            psDD.sAR2_Q14[0] = tmp2;
            let n_AR_Q10 = SKP_SMULWB(tmp2, AR_shp_Q13[arOffset]);

            for (let j = 2; j < shapingLPCOrder; j += 2) {
                tmp2 = SKP_SMLAWB(psDD.sAR2_Q14[j - 1], SKP_SUB32(psDD.sAR2_Q14[j], tmp1), warping_Q16);
                psDD.sAR2_Q14[j - 1] = tmp1;
                n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, tmp1, AR_shp_Q13[arOffset + j - 1]);

                tmp1 = SKP_SMLAWB(psDD.sAR2_Q14[j], SKP_SUB32(psDD.sAR2_Q14[j + 1], tmp2), warping_Q16);
                psDD.sAR2_Q14[j] = tmp2;
                n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, tmp2, AR_shp_Q13[arOffset + j]);
            }
            psDD.sAR2_Q14[shapingLPCOrder - 1] = tmp1;
            n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, tmp1, AR_shp_Q13[arOffset + shapingLPCOrder - 1]);
            n_AR_Q10 = SKP_RSHIFT(n_AR_Q10, 1);
            n_AR_Q10 = SKP_SMLAWB(n_AR_Q10, psDD.LF_AR_Q12, Tilt_Q14);

            let n_LF_Q10 = SKP_LSHIFT(SKP_SMULWB(psDD.Shape_Q10[smplBufIdxRef.val], LF_shp_Q14), 2);
            n_LF_Q10 = SKP_SMLAWT(n_LF_Q10, psDD.LF_AR_Q12, LF_shp_Q14);

            const tmpResidual_Q10 = SKP_SUB32(
                SKP_ADD32(SKP_RSHIFT(SKP_SUB32(LTP_pred_Q14, n_LTP_Q14), 4), LPC_pred_Q10),
                SKP_ADD32(n_AR_Q10, n_LF_Q10)
            );
            let r_Q10 = SKP_SUB32(x_Q10[i], tmpResidual_Q10);
            const rNoDither_Q10 = r_Q10;
            r_Q10 = (r_Q10 ^ dither) - dither;
            const rDithered_Q10 = r_Q10;
            r_Q10 = SKP_SUB32(r_Q10, offset_Q10);
            r_Q10 = SKP_LIMIT_32(r_Q10, -(64 << 10), 64 << 10);
            const rLimited_Q10 = r_Q10;

            let q1_Q10: number;
            let q2_Q10: number;
            let rd1_Q10: number;
            let rd2_Q10: number;

            if (r_Q10 < -1536) {
                q1_Q10 = SKP_LSHIFT(SKP_RSHIFT_ROUND(r_Q10, 10), 10);
                r_Q10 = SKP_SUB32(r_Q10, q1_Q10);
                rd1_Q10 = SKP_RSHIFT(
                    SKP_SMLABB(SKP_MUL(-SKP_ADD32(q1_Q10, offset_Q10), Lambda_Q10), r_Q10, r_Q10),
                    10
                );
                rd2_Q10 = SKP_SUB32(SKP_ADD32(rd1_Q10, 1024), addLShift32(Lambda_Q10, r_Q10, 1));
                q2_Q10 = SKP_ADD32(q1_Q10, 1024);
            } else if (r_Q10 > 512) {
                q1_Q10 = SKP_LSHIFT(SKP_RSHIFT_ROUND(r_Q10, 10), 10);
                r_Q10 = SKP_SUB32(r_Q10, q1_Q10);
                rd1_Q10 = SKP_RSHIFT(
                    SKP_SMLABB(SKP_MUL(SKP_ADD32(q1_Q10, offset_Q10), Lambda_Q10), r_Q10, r_Q10),
                    10
                );
                rd2_Q10 = SKP_SUB32(SKP_ADD32(rd1_Q10, 1024), subLShift32(Lambda_Q10, r_Q10, 1));
                q2_Q10 = SKP_SUB32(q1_Q10, 1024);
            } else {
                const rr_Q20 = SKP_SMULBB(offset_Q10, Lambda_Q10);
                rd2_Q10 = SKP_RSHIFT(SKP_SMLABB(rr_Q20, r_Q10, r_Q10), 10);
                rd1_Q10 = SKP_ADD32(rd2_Q10, 1024);
                rd1_Q10 = SKP_ADD32(rd1_Q10, subRShift32(addLShift32(Lambda_Q10, r_Q10, 1), rr_Q20, 9));
                q1_Q10 = -1024;
                q2_Q10 = 0;
            }

            if (rd1_Q10 < rd2_Q10) {
                bestState.RD_Q10 = SKP_ADD32(psDD.RD_Q10, rd1_Q10);
                secondState.RD_Q10 = SKP_ADD32(psDD.RD_Q10, rd2_Q10);
                bestState.Q_Q10 = q1_Q10;
                secondState.Q_Q10 = q2_Q10;
            } else {
                bestState.RD_Q10 = SKP_ADD32(psDD.RD_Q10, rd2_Q10);
                secondState.RD_Q10 = SKP_ADD32(psDD.RD_Q10, rd1_Q10);
                bestState.Q_Q10 = q2_Q10;
                secondState.Q_Q10 = q1_Q10;
            }

            let exc_Q10 = SKP_ADD32(offset_Q10, bestState.Q_Q10);
            exc_Q10 = (exc_Q10 ^ dither) - dither;
            let LPC_exc_Q10 = SKP_ADD32(exc_Q10, SKP_RSHIFT_ROUND(LTP_pred_Q14, 4));
            let xq_Q10 = SKP_ADD32(LPC_exc_Q10, LPC_pred_Q10);
            let sLF_AR_shp_Q10 = SKP_SUB32(xq_Q10, n_AR_Q10);
            bestState.sLTP_shp_Q10 = SKP_SUB32(sLF_AR_shp_Q10, n_LF_Q10);
            bestState.LF_AR_Q12 = SKP_LSHIFT(sLF_AR_shp_Q10, 2);
            bestState.xq_Q14 = SKP_LSHIFT(xq_Q10, 4);
            bestState.LPC_exc_Q16 = SKP_LSHIFT(LPC_exc_Q10, 6);

            exc_Q10 = SKP_ADD32(offset_Q10, secondState.Q_Q10);
            exc_Q10 = (exc_Q10 ^ dither) - dither;
            LPC_exc_Q10 = SKP_ADD32(exc_Q10, SKP_RSHIFT_ROUND(LTP_pred_Q14, 4));
            xq_Q10 = SKP_ADD32(LPC_exc_Q10, LPC_pred_Q10);
            sLF_AR_shp_Q10 = SKP_SUB32(xq_Q10, n_AR_Q10);
            secondState.sLTP_shp_Q10 = SKP_SUB32(sLF_AR_shp_Q10, n_LF_Q10);
            secondState.LF_AR_Q12 = SKP_LSHIFT(sLF_AR_shp_Q10, 2);
            secondState.xq_Q14 = SKP_LSHIFT(xq_Q10, 4);
            secondState.LPC_exc_Q16 = SKP_LSHIFT(LPC_exc_Q10, 6);
        }

        smplBufIdxRef.val = (smplBufIdxRef.val - 1) & DECISION_DELAY_MASK;
        const last_smple_idx = (smplBufIdxRef.val + decisionDelay) & DECISION_DELAY_MASK;

        let RDmin_Q10 = sampleStates[0][0].RD_Q10;
        let winnerIdx = 0;
        for (let k = 1; k < nStatesDelayedDecision; k++) {
            if (sampleStates[k][0].RD_Q10 < RDmin_Q10) {
                RDmin_Q10 = sampleStates[k][0].RD_Q10;
                winnerIdx = k;
            }
        }

        const winnerRandState = psDelDec[winnerIdx].RandState[last_smple_idx];
        for (let k = 0; k < nStatesDelayedDecision; k++) {
            if (psDelDec[k].RandState[last_smple_idx] !== winnerRandState) {
                sampleStates[k][0].RD_Q10 = SKP_ADD32(sampleStates[k][0].RD_Q10, SKP_INT32_MAX >> 4);
                sampleStates[k][1].RD_Q10 = SKP_ADD32(sampleStates[k][1].RD_Q10, SKP_INT32_MAX >> 4);
            }
        }

        let RDmax_Q10 = sampleStates[0][0].RD_Q10;
        RDmin_Q10 = sampleStates[0][1].RD_Q10;
        let RDmaxIdx = 0;
        let RDminIdx = 0;
        for (let k = 1; k < nStatesDelayedDecision; k++) {
            if (sampleStates[k][0].RD_Q10 > RDmax_Q10) {
                RDmax_Q10 = sampleStates[k][0].RD_Q10;
                RDmaxIdx = k;
            }
            if (sampleStates[k][1].RD_Q10 < RDmin_Q10) {
                RDmin_Q10 = sampleStates[k][1].RD_Q10;
                RDminIdx = k;
            }
        }

        if (RDmin_Q10 < RDmax_Q10) {
            copyDelayedDecisionState(psDelDec[RDmaxIdx], psDelDec[RDminIdx], i);
            sampleStates[RDmaxIdx][0] = { ...sampleStates[RDminIdx][1] };
        }

        const psWinner = psDelDec[winnerIdx];
        if (subfr > 0 || i >= decisionDelay) {
            q[qOffset + i - decisionDelay] = SKP_RSHIFT(psWinner.Q_Q10[last_smple_idx], 10);
            xq[xqOffset + i - decisionDelay] = SKP_SAT16(
                SKP_RSHIFT_ROUND(
                    SKP_SMULWW(psWinner.Xq_Q10[last_smple_idx], psWinner.Gain_Q16[last_smple_idx]),
                    10
                )
            );
            NSQ.sLTP_shp_Q10[NSQ.sLTP_shp_buf_idx - decisionDelay] = psWinner.Shape_Q10[last_smple_idx];
            sLTP_Q16[NSQ.sLTP_buf_idx - decisionDelay] = psWinner.Pred_Q16[last_smple_idx];
        }
        NSQ.sLTP_shp_buf_idx++;
        NSQ.sLTP_buf_idx++;

        for (let k = 0; k < nStatesDelayedDecision; k++) {
            const psDD = psDelDec[k];
            const psSS = sampleStates[k][0];
            psDD.LF_AR_Q12 = psSS.LF_AR_Q12;
            psDD.sLPC_Q14[NSQ_LPC_BUF_LENGTH + i] = psSS.xq_Q14;
            psDD.Xq_Q10[smplBufIdxRef.val] = SKP_RSHIFT(psSS.xq_Q14, 4);
            psDD.Q_Q10[smplBufIdxRef.val] = psSS.Q_Q10;
            psDD.Pred_Q16[smplBufIdxRef.val] = psSS.LPC_exc_Q16;
            psDD.Shape_Q10[smplBufIdxRef.val] = psSS.sLTP_shp_Q10;
            psDD.Seed = SKP_ADD_RSHIFT(psDD.Seed, psSS.Q_Q10, 10);
            psDD.RandState[smplBufIdxRef.val] = psDD.Seed;
            psDD.RD_Q10 = psSS.RD_Q10;
            psDD.Gain_Q16[smplBufIdxRef.val] = Gain_Q16;
        }
    }

    for (let k = 0; k < nStatesDelayedDecision; k++) {
        const psDD = psDelDec[k];
        for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
            psDD.sLPC_Q14[i] = psDD.sLPC_Q14[length + i];
        }
    }
}

function runNSQCore(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    useLbrr: boolean,
    x: Int16Array,
    q: Int8Array,
    LSFInterpFactor_Q2: number,
    PredCoef_Q12: Int16Array,
    LTPCoef_Q14: Int16Array,
    AR2_Q13: Int16Array,
    HarmShapeGain_Q14: Int32Array,
    Tilt_Q14: Int32Array,
    LF_shp_Q14: Int32Array,
    Gains_Q16: Int32Array,
    Lambda_Q10: number,
    LTP_scale_Q14: number
): void {
    const NSQ = ensureNSQState(psEnc, useLbrr);
    const frame_length = psEnc.frame_length;
    const subfr_length = psEnc.subfr_length;
    const predictLPCOrder = psEnc.sCmn.predictLPCOrder;
    const shapingLPCOrder = psEnc.shapingLPCOrder;
    const offset_Q10 = SKP_Silk_Quantization_Offsets_Q10[psEncCtrl.sigtype][psEncCtrl.QuantOffsetType];
    const LSF_interpolation_flag = LSFInterpFactor_Q2 === (1 << 2) ? 0 : 1;
    const sLTP_Q16 = new Int32Array(2 * MAX_FRAME_LENGTH);
    const sLTP = new Int16Array(2 * MAX_FRAME_LENGTH);
    const x_sc_Q10 = new Int32Array(MAX_FRAME_LENGTH / NB_SUBFR);
    const FiltState = new Int32Array(MAX_LPC_ORDER);
    const lags = new Array<number>(NB_SUBFR).fill(0);
    const invGains = new Array<number>(NB_SUBFR).fill(0);
    const rewhites = new Array<number>(NB_SUBFR).fill(0);
    const ltpIdxs = new Array<number>(NB_SUBFR).fill(0);
    const shpIdxs = new Array<number>(NB_SUBFR).fill(0);

    NSQ.rand_seed = psEncCtrl.Seed;
    let lag = NSQ.lagPrev;
    NSQ.sLTP_shp_buf_idx = frame_length;
    NSQ.sLTP_buf_idx = frame_length;
    let xOffset = 0;
    let qOffset = 0;
    let xqOffset = frame_length;

    for (let k = 0; k < NB_SUBFR; k++) {
        const aIndex = (((k >> 1) | (1 - LSF_interpolation_flag)) * MAX_LPC_ORDER) | 0;
        const bIndex = (k * LTP_ORDER) | 0;
        const arIndex = (k * MAX_SHAPE_LPC_ORDER) | 0;
        const harmGain = HarmShapeGain_Q14[k] | 0;
        let HarmShapeFIRPacked_Q14 = SKP_RSHIFT(harmGain, 2);
        HarmShapeFIRPacked_Q14 |= SKP_LSHIFT(SKP_RSHIFT(harmGain, 1), 16);

        NSQ.rewhite_flag = 0;
        if (psEncCtrl.sigtype === SIG_TYPE_VOICED) {
            lag = psEncCtrl.pitchL[k] | 0;
            if ((k & (3 - (LSF_interpolation_flag << 1))) === 0) {
                const start_idx = frame_length - lag - predictLPCOrder - (LTP_ORDER >> 1);
                for (let i = 0; i < predictLPCOrder; i++) {
                    FiltState[i] = 0;
                }
                SKP_Silk_MA_Prediction(
                    NSQ.xq,
                    start_idx + k * subfr_length,
                    PredCoef_Q12,
                    aIndex,
                    FiltState,
                    0,
                    sLTP,
                    start_idx,
                    frame_length - start_idx,
                    predictLPCOrder
                );
                NSQ.rewhite_flag = 1;
                NSQ.sLTP_buf_idx = frame_length;
            }
        }

        invGains[k] = nsqScaleStates(
            NSQ,
            x,
            xOffset,
            x_sc_Q10,
            subfr_length,
            sLTP,
            sLTP_Q16,
            k,
            LTP_scale_Q14,
            Gains_Q16,
            psEncCtrl.pitchL
        );

        noiseShapeQuantizer(
            NSQ,
            psEncCtrl.sigtype,
            x_sc_Q10,
            q,
            qOffset,
            NSQ.xq,
            xqOffset,
            sLTP_Q16,
            PredCoef_Q12,
            aIndex,
            LTPCoef_Q14,
            bIndex,
            AR2_Q13,
            arIndex,
            lag,
            HarmShapeFIRPacked_Q14,
            Tilt_Q14[k] | 0,
            LF_shp_Q14[k] | 0,
            Gains_Q16[k] | 0,
            Lambda_Q10,
            offset_Q10,
            subfr_length,
            shapingLPCOrder,
            predictLPCOrder
        );

        lags[k] = lag;
        rewhites[k] = NSQ.rewhite_flag;
        ltpIdxs[k] = NSQ.sLTP_buf_idx;
        shpIdxs[k] = NSQ.sLTP_shp_buf_idx;

        xOffset += subfr_length;
        qOffset += subfr_length;
        xqOffset += subfr_length;
    }

    traceNSQSubframes(psEnc, q, 0, NSQ.xq, frame_length, subfr_length, lags, Gains_Q16, invGains, rewhites, ltpIdxs, shpIdxs);
    NSQ.lagPrev = psEncCtrl.pitchL[NB_SUBFR - 1] | 0;
    copyFinalNSQState(NSQ, frame_length);
}

function runNSQDelayedDecision(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    useLbrr: boolean,
    x: Int16Array,
    q: Int8Array,
    LSFInterpFactor_Q2: number,
    PredCoef_Q12: Int16Array,
    LTPCoef_Q14: Int16Array,
    AR2_Q13: Int16Array,
    HarmShapeGain_Q14: Int32Array,
    Tilt_Q14: Int32Array,
    LF_shp_Q14: Int32Array,
    Gains_Q16: Int32Array,
    Lambda_Q10: number,
    LTP_scale_Q14: number
): void {
    const NSQ = ensureNSQState(psEnc, useLbrr);
    const frame_length = psEnc.frame_length;
    const subfr_length = psEnc.subfr_length;
    const predictLPCOrder = psEnc.sCmn.predictLPCOrder | 0;
    const shapingLPCOrder = psEnc.shapingLPCOrder | 0;
    const nStatesDelayedDecision = SKP_min(psEnc.nStatesDelayedDecision | 0, MAX_DEL_DEC_STATES);
    const offset_Q10 = SKP_Silk_Quantization_Offsets_Q10[psEncCtrl.sigtype][psEncCtrl.QuantOffsetType];
    const LSF_interpolation_flag = LSFInterpFactor_Q2 === (1 << 2) ? 0 : 1;
    const sLTP_Q16 = new Int32Array(2 * MAX_FRAME_LENGTH);
    const sLTP = new Int16Array(2 * MAX_FRAME_LENGTH);
    const x_sc_Q10 = new Int32Array(MAX_FRAME_LENGTH / NB_SUBFR);
    const FiltState = new Int32Array(MAX_LPC_ORDER);
    const psDelDec = Array.from({ length: nStatesDelayedDecision }, () => createDelayedDecisionState());
    const lags = new Array<number>(NB_SUBFR).fill(0);
    const invGains = new Array<number>(NB_SUBFR).fill(0);
    const rewhites = new Array<number>(NB_SUBFR).fill(0);
    const ltpIdxs = new Array<number>(NB_SUBFR).fill(0);
    const shpIdxs = new Array<number>(NB_SUBFR).fill(0);

    let lag = NSQ.lagPrev;
    let decisionDelay = SKP_min(DECISION_DELAY, subfr_length);
    if (psEncCtrl.sigtype === SIG_TYPE_VOICED) {
        for (let k = 0; k < NB_SUBFR; k++) {
            decisionDelay = SKP_min(decisionDelay, (psEncCtrl.pitchL[k] | 0) - (LTP_ORDER >> 1) - 1);
        }
    } else if (lag > 0) {
        decisionDelay = SKP_min(decisionDelay, lag - (LTP_ORDER >> 1) - 1);
    }

    for (let k = 0; k < nStatesDelayedDecision; k++) {
        const psDD = psDelDec[k];
        psDD.Seed = (k + (psEncCtrl.Seed | 0)) & 3;
        psDD.SeedInit = psDD.Seed;
        psDD.RD_Q10 = 0;
        psDD.LF_AR_Q12 = NSQ.sLF_AR_shp_Q12;
        psDD.Shape_Q10[0] = NSQ.sLTP_shp_Q10[frame_length - 1];
        for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
            psDD.sLPC_Q14[i] = NSQ.sLPC_Q14[i];
        }
        for (let i = 0; i < MAX_SHAPE_LPC_ORDER; i++) {
            psDD.sAR2_Q14[i] = NSQ.sAR2_Q14[i];
        }
    }

    const smplBufIdxRef = { val: 0 };
    let xOffset = 0;
    let qOffset = 0;
    let xqOffset = frame_length;
    let subfrCounter = 0;
    NSQ.sLTP_shp_buf_idx = frame_length;
    NSQ.sLTP_buf_idx = frame_length;

    for (let k = 0; k < NB_SUBFR; k++) {
        const aIndex = (((k >> 1) | (1 - LSF_interpolation_flag)) * MAX_LPC_ORDER) | 0;
        const bIndex = (k * LTP_ORDER) | 0;
        const arIndex = (k * MAX_SHAPE_LPC_ORDER) | 0;
        const harmGain = HarmShapeGain_Q14[k] | 0;
        let HarmShapeFIRPacked_Q14 = SKP_RSHIFT(harmGain, 2);
        HarmShapeFIRPacked_Q14 |= SKP_LSHIFT(SKP_RSHIFT(harmGain, 1), 16);

        NSQ.rewhite_flag = 0;
        if (psEncCtrl.sigtype === SIG_TYPE_VOICED) {
            lag = psEncCtrl.pitchL[k] | 0;
            if ((k & (3 - (LSF_interpolation_flag << 1))) === 0) {
                if (k === 2) {
                    let RDmin_Q10 = psDelDec[0].RD_Q10;
                    let winnerIdx = 0;
                    for (let i = 1; i < nStatesDelayedDecision; i++) {
                        if (psDelDec[i].RD_Q10 < RDmin_Q10) {
                            RDmin_Q10 = psDelDec[i].RD_Q10;
                            winnerIdx = i;
                        }
                    }
                    for (let i = 0; i < nStatesDelayedDecision; i++) {
                        if (i !== winnerIdx) {
                            psDelDec[i].RD_Q10 = SKP_ADD32(psDelDec[i].RD_Q10, SKP_INT32_MAX >> 4);
                        }
                    }

                    const psWinner = psDelDec[winnerIdx];
                    let last_smple_idx = smplBufIdxRef.val + decisionDelay;
                    for (let i = 0; i < decisionDelay; i++) {
                        last_smple_idx = (last_smple_idx - 1) & DECISION_DELAY_MASK;
                        q[qOffset + i - decisionDelay] = SKP_RSHIFT(psWinner.Q_Q10[last_smple_idx], 10);
                        NSQ.xq[xqOffset + i - decisionDelay] = SKP_SAT16(
                            SKP_RSHIFT_ROUND(
                                SKP_SMULWW(psWinner.Xq_Q10[last_smple_idx], psWinner.Gain_Q16[last_smple_idx]),
                                10
                            )
                        );
                        NSQ.sLTP_shp_Q10[NSQ.sLTP_shp_buf_idx - decisionDelay + i] = psWinner.Shape_Q10[last_smple_idx];
                    }
                    subfrCounter = 0;
                }

                const start_idx = frame_length - lag - predictLPCOrder - (LTP_ORDER >> 1);
                for (let i = 0; i < predictLPCOrder; i++) {
                    FiltState[i] = 0;
                }
                SKP_Silk_MA_Prediction(
                    NSQ.xq,
                    start_idx + k * subfr_length,
                    PredCoef_Q12,
                    aIndex,
                    FiltState,
                    0,
                    sLTP,
                    start_idx,
                    frame_length - start_idx,
                    predictLPCOrder
                );
                NSQ.sLTP_buf_idx = frame_length;
                NSQ.rewhite_flag = 1;
            }
        }

        invGains[k] = nsqDelDecScaleStates(
            NSQ,
            psDelDec,
            x,
            xOffset,
            x_sc_Q10,
            subfr_length,
            sLTP,
            sLTP_Q16,
            k,
            nStatesDelayedDecision,
            LTP_scale_Q14,
            Gains_Q16,
            psEncCtrl.pitchL
        );

        noiseShapeQuantizerDelDec(
            NSQ,
            psDelDec,
            psEncCtrl.sigtype,
            x_sc_Q10,
            q,
            qOffset,
            NSQ.xq,
            xqOffset,
            sLTP_Q16,
            PredCoef_Q12,
            aIndex,
            LTPCoef_Q14,
            bIndex,
            AR2_Q13,
            arIndex,
            lag,
            HarmShapeFIRPacked_Q14,
            Tilt_Q14[k] | 0,
            LF_shp_Q14[k] | 0,
            Gains_Q16[k] | 0,
            Lambda_Q10,
            offset_Q10,
            subfr_length,
            subfrCounter,
            shapingLPCOrder,
            predictLPCOrder,
            psEnc.warping_Q16 | 0,
            nStatesDelayedDecision,
            smplBufIdxRef,
            decisionDelay
        );
        subfrCounter++;

        lags[k] = lag;
        rewhites[k] = NSQ.rewhite_flag;
        ltpIdxs[k] = NSQ.sLTP_buf_idx;
        shpIdxs[k] = NSQ.sLTP_shp_buf_idx;

        xOffset += subfr_length;
        qOffset += subfr_length;
        xqOffset += subfr_length;
    }

    let RDmin_Q10 = psDelDec[0].RD_Q10;
    let winnerIdx = 0;
    for (let k = 1; k < nStatesDelayedDecision; k++) {
        if (psDelDec[k].RD_Q10 < RDmin_Q10) {
            RDmin_Q10 = psDelDec[k].RD_Q10;
            winnerIdx = k;
        }
    }

    const psWinner = psDelDec[winnerIdx];
    psEncCtrl.Seed = psWinner.SeedInit;
    let last_smple_idx = smplBufIdxRef.val + decisionDelay;
    for (let i = 0; i < decisionDelay; i++) {
        last_smple_idx = (last_smple_idx - 1) & DECISION_DELAY_MASK;
        q[frame_length + i - decisionDelay] = SKP_RSHIFT(psWinner.Q_Q10[last_smple_idx], 10);
        NSQ.xq[2 * frame_length + i - decisionDelay] = SKP_SAT16(
            SKP_RSHIFT_ROUND(
                SKP_SMULWW(psWinner.Xq_Q10[last_smple_idx], psWinner.Gain_Q16[last_smple_idx]),
                10
            )
        );
        NSQ.sLTP_shp_Q10[NSQ.sLTP_shp_buf_idx - decisionDelay + i] = psWinner.Shape_Q10[last_smple_idx];
        sLTP_Q16[NSQ.sLTP_buf_idx - decisionDelay + i] = psWinner.Pred_Q16[last_smple_idx];
    }

    for (let i = 0; i < NSQ_LPC_BUF_LENGTH; i++) {
        NSQ.sLPC_Q14[i] = psWinner.sLPC_Q14[subfr_length + i];
    }
    for (let i = 0; i < MAX_SHAPE_LPC_ORDER; i++) {
        NSQ.sAR2_Q14[i] = psWinner.sAR2_Q14[i];
    }

    traceNSQSubframes(psEnc, q, 0, NSQ.xq, frame_length, subfr_length, lags, Gains_Q16, invGains, rewhites, ltpIdxs, shpIdxs);
    NSQ.sLF_AR_shp_Q12 = psWinner.LF_AR_Q12;
    NSQ.lagPrev = psEncCtrl.pitchL[NB_SUBFR - 1] | 0;
    copyFinalNSQState(NSQ, frame_length);
}

export function NSQ_del_dec(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    psRC: any,
    x: Int16Array,
    q: Int8Array,
    LSFInterpFactor_Q2: number,
    PredCoef_Q12: Int16Array,
    LTPCoef_Q14: Int16Array,
    AR2_Q13: Int16Array,
    HarmShapeGain_Q14: Int32Array,
    Tilt_Q14: Int32Array,
    LF_shp_Q14: Int32Array,
    Gains_Q16: Int32Array,
    Lambda_Q10: number,
    LTP_scale_Q14: number,
    useLbrr: boolean = false
): void {
    runNSQDelayedDecision(
        psEnc,
        psEncCtrl,
        useLbrr,
        x,
        q,
        LSFInterpFactor_Q2,
        PredCoef_Q12,
        LTPCoef_Q14,
        AR2_Q13,
        HarmShapeGain_Q14,
        Tilt_Q14,
        LF_shp_Q14,
        Gains_Q16,
        Lambda_Q10,
        LTP_scale_Q14
    );
}

export function NSQ(
    psEnc: EncoderState,
    psEncCtrl: EncoderControl,
    psRC: any,
    x: Int16Array,
    q: Int8Array,
    LSFInterpFactor_Q2: number,
    PredCoef_Q12: Int16Array,
    LTPCoef_Q14: Int16Array,
    AR2_Q13: Int16Array,
    HarmShapeGain_Q14: Int32Array,
    Tilt_Q14: Int32Array,
    LF_shp_Q14: Int32Array,
    Gains_Q16: Int32Array,
    Lambda_Q10: number,
    LTP_scale_Q14: number,
    useLbrr: boolean = false
): void {
    runNSQCore(
        psEnc,
        psEncCtrl,
        useLbrr,
        x,
        q,
        LSFInterpFactor_Q2,
        PredCoef_Q12,
        LTPCoef_Q14,
        AR2_Q13,
        HarmShapeGain_Q14,
        Tilt_Q14,
        LF_shp_Q14,
        Gains_Q16,
        Lambda_Q10,
        LTP_scale_Q14
    );
}
