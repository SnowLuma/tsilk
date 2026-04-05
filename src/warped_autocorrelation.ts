/**
 * Warped autocorrelation for noise shaping analysis.
 * Ported from SKP_Silk_warped_autocorrelation_FIX.c (SILK SDK v3).
 *
 * Algorithm overview
 * ------------------
 * An all-poles warped-lattice filter propagates each input sample through
 * MAX_SHAPE_LPC_ORDER+1 delay elements while accumulating cross-products
 * of those states against state_QS[0] (the current-sample entry).  The
 * result is a set of (order+1) warped autocorrelation coefficients stored
 * in a common Q-domain determined by a CLZ-based scaling step.
 *
 * Fixed-point notation used throughout:
 *   QS  = 14   – Q-domain of the filter state array (state_QS)
 *   QC  = 10   – Q-domain of the raw 64-bit accumulators (corr_QC)
 *   SHIFT = 2*QS - QC = 18  – right-shift applied before each accumulation
 */

import { SKP_SMLAWB } from './macros';
import { MAX_SHAPE_LPC_ORDER } from './defines';

// ── Constants ───────────────────────────────────────────────────────────────

const QC    = 10;  // accumulator Q-domain
const QS    = 14;  // filter-state Q-domain
const SHIFT = 2 * QS - QC; // 18 – right-shift before accumulation

// Pre-compute BigInt versions of frequently used constants so they are
// not recreated on every sample iteration.
const B_SHIFT = BigInt(SHIFT); // 18n

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Count leading zeros in the 64-bit magnitude of a non-negative BigInt.
 * Matches the behaviour of `SKP_Silk_CLZ64()` from the SILK SDK:
 *   – if the upper 32 bits are non-zero  →  Math.clz32(upper32)
 *   – otherwise                          →  32 + Math.clz32(lower32)
 *
 * @param x  A non-negative BigInt (absolute value of corr_QC[0]).
 * @returns  Number of leading zeros in the 64-bit representation (0–64).
 */
function clz64(x: bigint): number {
    if (x <= 0n) return 64;
    const upper32 = Number((x >> 32n) & 0xFFFF_FFFFn);
    if (upper32 === 0) {
        const lower32 = Number(x & 0xFFFF_FFFFn);
        return 32 + (lower32 === 0 ? 32 : Math.clz32(lower32));
    }
    return Math.clz32(upper32);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the warped autocorrelation sequence of a windowed input signal.
 *
 * The output array `corr` receives (order+1) coefficients in
 * Q(-scale.val) format, i.e. the caller can undo the scaling with:
 *
 *   actual_corr[i] = corr[i] * 2^(scale.val)
 *
 * @param corr        Output Int32Array of length ≥ order+1.
 * @param scale       Output object; `.val` is set to the Q-domain scale
 *                    (range −30 … +12).
 * @param input       Windowed input samples (Int16Array, length == `length`).
 * @param warping_Q16 Warping coefficient in Q16.  Only the low 16 bits are
 *                    used (the C prototype declares this as SKP_int16).
 * @param length      Number of input samples to process.
 * @param order       LPC order (must be even); correlations 0..order are
 *                    written into `corr`.
 */
export function SKP_Silk_warped_autocorrelation_FIX(
    corr: Int32Array,
    scale: { val: number },
    input: Int16Array,
    warping_Q16: number,
    length: number,
    order: number,
): void {
    // The C function signature uses SKP_int16 for warping_Q16, meaning only
    // the lower 16 bits participate and they are sign-extended.
    const warp16: number = ((warping_Q16 & 0xFFFF) << 16) >> 16; // → int16

    // All-poles warped lattice filter state in Q(QS).
    // Allocated at MAX_SHAPE_LPC_ORDER+1 to match C's stack array.
    const state_QS = new Int32Array(MAX_SHAPE_LPC_ORDER + 1); // zero-initialised

    // 64-bit correlation accumulators in Q(QC).
    // We use plain bigint[] (arbitrary precision) rather than BigInt64Array so
    // that edge-case accumulations beyond ±2^63 cannot silently wrap.
    const corr_QC: bigint[] = new Array<bigint>(MAX_SHAPE_LPC_ORDER + 1).fill(0n);

    // ── Main sample loop ─────────────────────────────────────────────────────
    for (let n = 0; n < length; n++) {
        // Promote the current Int16 sample to Q(QS).
        // 16-bit × 2^14 ≤ 2^29 – result always fits in int32.
        let tmp1_QS: number = input[n] << QS;

        // Process pairs of taps (order must be even).
        for (let i = 0; i < order; i += 2) {
            // ── Even tap (index i) ──────────────────────────────────────────
            //   tmp2_QS = state_QS[i] + SMULWB(state_QS[i+1] - tmp1_QS, warp16)
            const tmp2_QS: number =
                SKP_SMLAWB(state_QS[i], (state_QS[i + 1] - tmp1_QS) | 0, warp16) | 0;

            // Update state BEFORE the accumulation so that for i==0 the
            // accumulation uses state_QS[0] == tmp1_QS (the current sample),
            // exactly as in the C source.
            state_QS[i] = tmp1_QS;

            // corr_QC[i] += (tmp1_QS * state_QS[0]) >> SHIFT
            // For i==0: state_QS[0] was just set to tmp1_QS → accumulates x²
            // For i >0: state_QS[0] holds the input sample set at i==0
            corr_QC[i] +=
                (BigInt(tmp1_QS) * BigInt(state_QS[0])) >> B_SHIFT;

            // ── Odd tap (index i+1) ─────────────────────────────────────────
            //   newTmp1 = state_QS[i+1] + SMULWB(state_QS[i+2] - tmp2_QS, warp16)
            const newTmp1_QS: number =
                SKP_SMLAWB(state_QS[i + 1], (state_QS[i + 2] - tmp2_QS) | 0, warp16) | 0;

            state_QS[i + 1] = tmp2_QS;

            corr_QC[i + 1] +=
                (BigInt(tmp2_QS) * BigInt(state_QS[0])) >> B_SHIFT;

            // Carry the pipeline value forward to the next even tap.
            tmp1_QS = newTmp1_QS;
        }

        // ── Final tap (index == order) ────────────────────────────────────────
        state_QS[order] = tmp1_QS;
        corr_QC[order] +=
            (BigInt(tmp1_QS) * BigInt(state_QS[0])) >> B_SHIFT;
    }

    // ── Scaling step (matches SKP_Silk_CLZ64 + clamping in C) ────────────────
    //
    // corr_QC[0] is the energy term (sum of squares) and is always ≥ 0.
    // We compute how many bits we can left-shift without overflow into int32.
    const absCorr0: bigint = corr_QC[0] >= 0n ? corr_QC[0] : -corr_QC[0];

    // lsh = clz64(absCorr0) - 35
    // Intuition: a 64-bit value has (64 - bit_length) leading zeros; we want
    // the result shifted so the top bit lands at bit 29 (i.e. fits in int32
    // after adding QC = 10 bits of fractional headroom → 35 = 64 - 29).
    let lsh: number = clz64(absCorr0) - 35;

    // Clamp to keep scale.val in [-30, 12].
    //   scale.val = -(QC + lsh)
    //   lsh_min = -12 - QC = -22  →  scale.val_max = 30
    //   lsh_max =  30 - QC =  20  →  scale.val_min = -30
    const LSH_MIN = -12 - QC; // -22
    const LSH_MAX =  30 - QC; //  20
    if      (lsh < LSH_MIN) lsh = LSH_MIN;
    else if (lsh > LSH_MAX) lsh = LSH_MAX;

    scale.val = -(QC + lsh); // output scale in range [-30, 12]

    // ── Write scaled int32 output ─────────────────────────────────────────────
    if (lsh >= 0) {
        const blsh = BigInt(lsh);
        for (let i = 0; i <= order; i++) {
            // Left-shift accumulator; clamp to int32 via asIntN(32, …).
            corr[i] = Number(BigInt.asIntN(32, corr_QC[i] << blsh));
        }
    } else {
        const bnlsh = BigInt(-lsh);
        for (let i = 0; i <= order; i++) {
            // Arithmetic right-shift (BigInt >> preserves sign for negatives).
            corr[i] = Number(BigInt.asIntN(32, corr_QC[i] >> bnlsh));
        }
    }
}
