/**
 * LPC inverse prediction gain (stability check)
 * Ported from SKP_Silk_LPC_inv_pred_gain.c
 */
import {
  toInt32,
  SKP_LSHIFT,
  SKP_RSHIFT,
  SKP_SMMUL,
  SKP_INVERSE32_varQ,
  SKP_Silk_CLZ32,
  SKP_RSHIFT_ROUND,
} from "./macros";

const QA = 16;
const A_LIMIT = 65520; // SKP_FIX_CONST(0.99975, 16)
const SKP_int32_MAX = 0x7fffffff;

function LPC_inverse_pred_gain_QA(
  A_QA: Int32Array[],
  order: number,
): { invGain_Q30: number; unstable: boolean } {
  let Anew_QA = A_QA[order & 1];
  let invGain_Q30 = 1 << 30;

  for (let k = order - 1; k > 0; k--) {
    if (Anew_QA[k] > A_LIMIT || Anew_QA[k] < -A_LIMIT) {
      
      return { invGain_Q30: 0, unstable: true };
    }

    const rc_Q31 = toInt32(-SKP_LSHIFT(Anew_QA[k], 31 - QA));
    const rc_mult1_Q30 = toInt32(
      (SKP_int32_MAX >> 1) - SKP_SMMUL(rc_Q31, rc_Q31),
    );
    if (rc_mult1_Q30 <= 1 << 15) {
      
      return { invGain_Q30: 0, unstable: true };
    }

    const rc_mult2_Q16 = SKP_INVERSE32_varQ(rc_mult1_Q30, 46);

    invGain_Q30 = toInt32(SKP_LSHIFT(SKP_SMMUL(invGain_Q30, rc_mult1_Q30), 2));

    const Aold_QA = Anew_QA;
    Anew_QA = A_QA[k & 1];

    const headrm = SKP_Silk_CLZ32(rc_mult2_Q16) - 1;
    const rc_mult2_shifted = SKP_LSHIFT(rc_mult2_Q16, headrm);
    for (let n = 0; n < k; n++) {
      const tmp_QA = toInt32(
        Aold_QA[n] - SKP_LSHIFT(SKP_SMMUL(Aold_QA[k - n - 1], rc_Q31), 1),
      );
      Anew_QA[n] = toInt32(
        SKP_LSHIFT(SKP_SMMUL(tmp_QA, rc_mult2_shifted), 16 - headrm),
      );
    }
  }

  if (Anew_QA[0] > A_LIMIT || Anew_QA[0] < -A_LIMIT) {
    
    return { invGain_Q30: 0, unstable: true };
  }

  const rc_Q31 = toInt32(-SKP_LSHIFT(Anew_QA[0], 31 - QA));
  const rc_mult1_Q30 = toInt32(
    (SKP_int32_MAX >> 1) - SKP_SMMUL(rc_Q31, rc_Q31),
  );
  invGain_Q30 = toInt32(SKP_LSHIFT(SKP_SMMUL(invGain_Q30, rc_mult1_Q30), 2));

  return { invGain_Q30, unstable: false };
}

/** Check Q12 LPC filter stability. Returns 1 if unstable. */
export function LPC_inverse_pred_gain(
  A_Q12: Int16Array,
  order: number,
): { invGain_Q30: number; unstable: boolean } {
  const Atmp_QA = [new Int32Array(16), new Int32Array(16)];
  const Anew_QA = Atmp_QA[order & 1];
  for (let k = 0; k < order; k++) {
    Anew_QA[k] = SKP_LSHIFT(A_Q12[k], QA - 12);
  }
  return LPC_inverse_pred_gain_QA(Atmp_QA, order);
}

/**
 * Compute inverse of LPC prediction gain for Q24 coefficients.
 * Equivalent to C SKP_Silk_LPC_inverse_pred_gain_Q24.
 * Returns invGain_Q30 (0 if unstable).
 */
export function LPC_inverse_pred_gain_Q24(
  A_Q24: Int32Array,
  order: number,
): number {
  const Atmp_QA = [new Int32Array(16), new Int32Array(16)];
  const Anew_QA = Atmp_QA[order & 1];
  // Convert Q24 to QA=16: shift right by (24 - 16) = 8, with rounding
  for (let k = 0; k < order; k++) {
    Anew_QA[k] = SKP_RSHIFT_ROUND(A_Q24[k], 24 - QA);
  }
  const result = LPC_inverse_pred_gain_QA(Atmp_QA, order);
  if (result.invGain_Q30 === 0) {
      
  }
  return result.invGain_Q30;
}
